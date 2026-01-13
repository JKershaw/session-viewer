import type { Event, Annotation, AnnotationType, Session } from '../types/index.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

// Create proxy agent if HTTPS_PROXY is set
const getProxyDispatcher = () => {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    return new ProxyAgent(proxyUrl);
  }
  return undefined;
};

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Creates an OpenRouter client for LLM analysis
 */
export const createOpenRouterClient = (config: OpenRouterConfig) => {
  const { apiKey, model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL } = config;

  const chat = async (messages: ChatMessage[]): Promise<string> => {
    const dispatcher = getProxyDispatcher();
    const response = await undiciFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://session-viewer.local',
        'X-Title': 'Claude Code Session Analyzer'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 2000
      }),
      dispatcher
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    return data.choices[0]?.message?.content ?? '';
  };

  return { chat };
};

/**
 * Summarizes events for the analysis prompt
 */
export const summarizeEvents = (events: Event[]): string => {
  const eventSummaries = events.map((e, i) => {
    const tokenStr = e.tokenCount > 0 ? ` (${e.tokenCount} tokens)` : '';
    const timestamp = e.timestamp ? new Date(e.timestamp).toISOString() : 'unknown time';

    let detail = '';
    if (e.type === 'git_op') {
      const raw = e.raw as Record<string, unknown>;
      const input = raw.input as Record<string, unknown> | undefined;
      const cmd = input?.command ?? raw.content ?? '';
      detail = `: ${String(cmd).substring(0, 100)}`;
    } else if (e.type === 'error') {
      const raw = e.raw as Record<string, unknown>;
      const error = raw.error as Record<string, unknown> | undefined;
      const msg = error?.message ?? e.raw.message?.content ?? 'unknown error';
      detail = `: ${String(msg).substring(0, 100)}`;
    }

    return `${i + 1}. [${timestamp}] ${e.type}${tokenStr}${detail}`;
  });

  // Limit to significant events if too many
  if (eventSummaries.length > 100) {
    const significant = events
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) =>
          e.type === 'git_op' ||
          e.type === 'error' ||
          e.type === 'user_message' ||
          e.tokenCount > 1000
      )
      .map(({ e, i }) => {
        const tokenStr = e.tokenCount > 0 ? ` (${e.tokenCount} tokens)` : '';
        const timestamp = e.timestamp ? new Date(e.timestamp).toISOString() : 'unknown';
        return `${i + 1}. [${timestamp}] ${e.type}${tokenStr}`;
      });

    return `Session has ${events.length} events. Significant events:\n${significant.join('\n')}`;
  }

  return eventSummaries.join('\n');
};

/**
 * Builds the analysis prompt for a session
 */
export const buildAnalysisPrompt = (session: Session): ChatMessage[] => {
  const eventSummary = summarizeEvents(session.events);

  const systemPrompt = `You are an expert at analyzing Claude Code session logs to identify patterns of friction, blockers, and decision points.

Your task is to analyze a session and identify:
1. **Decisions**: Key moments where a significant choice was made (e.g., architectural decisions, changing approach)
2. **Blockers**: Extended periods where progress stalled on a single problem (repeated attempts, errors, debugging)
3. **Rework**: Instances of revisiting completed work (undoing changes, reverting, re-implementing)
4. **Goal Shifts**: Changes in the overall objective during the session

For each annotation, provide:
- type: decision | blocker | rework | goal_shift
- eventIndex: the event number where this occurred
- summary: 1-2 sentence description
- confidence: 0.0-1.0 indicating certainty

Respond with a JSON array of annotations. Example:
[
  {"type": "blocker", "eventIndex": 15, "summary": "Extended debugging of authentication error across 10 events", "confidence": 0.85},
  {"type": "decision", "eventIndex": 42, "summary": "Chose to use SQLite instead of PostgreSQL for simplicity", "confidence": 0.9}
]

If no significant patterns are found, return an empty array: []`;

  const userPrompt = `Analyze this Claude Code session:

Session ID: ${session.id}
Duration: ${Math.round(session.durationMs / 60000)} minutes
Total Tokens: ${session.totalTokens}
Folder: ${session.folder}
Branch: ${session.branch || 'N/A'}

Events:
${eventSummary}

Identify decisions, blockers, rework, and goal shifts. Return JSON array only.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
};

/**
 * Parses the LLM response into annotations
 */
export const parseAnnotations = (response: string): Annotation[] => {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // Try to find JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          isValidAnnotationType(item.type) &&
          typeof item.summary === 'string'
      )
      .map((item) => ({
        type: item.type as AnnotationType,
        eventIndex: typeof item.eventIndex === 'number' ? item.eventIndex : undefined,
        summary: item.summary,
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.5
      }));
  } catch {
    return [];
  }
};

const isValidAnnotationType = (type: unknown): type is AnnotationType => {
  return type === 'decision' || type === 'blocker' || type === 'rework' || type === 'goal_shift';
};

/**
 * Analyzes a session and returns annotations
 */
export const analyzeSession = async (
  client: ReturnType<typeof createOpenRouterClient>,
  session: Session
): Promise<Annotation[]> => {
  if (session.events.length === 0) {
    return [];
  }

  const messages = buildAnalysisPrompt(session);
  const response = await client.chat(messages);
  return parseAnnotations(response);
};

/**
 * Gets OpenRouter config from environment
 */
export const getOpenRouterConfig = (): OpenRouterConfig | null => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL
  };
};
