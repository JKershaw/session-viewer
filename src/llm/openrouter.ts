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
 * Extracts meaningful content from a raw log entry based on event type
 */
const extractEventDetail = (event: Event): string => {
  const raw = event.raw as Record<string, unknown>;
  const message = raw.message as Record<string, unknown> | undefined;
  const content = message?.content;

  switch (event.type) {
    case 'user_message': {
      // Extract user's actual message
      if (typeof content === 'string') {
        return `USER: "${content.substring(0, 200)}${content.length > 200 ? '...' : ''}"`;
      }
      if (Array.isArray(content)) {
        const textPart = content.find((c: unknown) =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text'
        ) as Record<string, unknown> | undefined;
        if (textPart?.text) {
          const text = String(textPart.text);
          return `USER: "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`;
        }
        // Tool result
        const toolResult = content.find((c: unknown) =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_result'
        ) as Record<string, unknown> | undefined;
        if (toolResult) {
          return `TOOL_RESULT`;
        }
      }
      return 'USER: [message]';
    }

    case 'assistant_message': {
      // Skip thinking blocks, extract text or tool use
      if (Array.isArray(content)) {
        const toolUse = content.find((c: unknown) =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_use'
        ) as Record<string, unknown> | undefined;
        if (toolUse) {
          const toolName = toolUse.name ?? 'unknown';
          const input = toolUse.input as Record<string, unknown> | undefined;
          return formatToolCall(String(toolName), input);
        }
        const textPart = content.find((c: unknown) =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text'
        ) as Record<string, unknown> | undefined;
        if (textPart?.text) {
          const text = String(textPart.text);
          // Only include if it's short or contains key words
          if (text.length < 100 || /error|instead|chang|revert|fix|bug|issue/i.test(text)) {
            return `ASSISTANT: "${text.substring(0, 150)}${text.length > 150 ? '...' : ''}"`;
          }
        }
      }
      return 'ASSISTANT: [response]';
    }

    case 'tool_call': {
      // Extract tool name and key input
      if (Array.isArray(content)) {
        const toolUse = content.find((c: unknown) =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'tool_use'
        ) as Record<string, unknown> | undefined;
        if (toolUse) {
          const toolName = toolUse.name ?? 'unknown';
          const input = toolUse.input as Record<string, unknown> | undefined;
          return formatToolCall(String(toolName), input);
        }
      }
      return 'TOOL: [call]';
    }

    case 'git_op': {
      const input = raw.input as Record<string, unknown> | undefined;
      const cmd = input?.command ?? raw.content ?? '';
      return `GIT: ${String(cmd).substring(0, 120)}`;
    }

    case 'error': {
      const error = raw.error as Record<string, unknown> | undefined;
      const errorMsg = error?.message ?? message?.content ?? 'unknown error';
      return `ERROR: ${String(errorMsg).substring(0, 150)}`;
    }

    case 'planning_mode': {
      return 'PLANNING: [thinking]';
    }

    default:
      return event.type;
  }
};

/**
 * Formats a tool call with its key input parameters
 */
const formatToolCall = (toolName: string, input: Record<string, unknown> | undefined): string => {
  if (!input) return `TOOL ${toolName}`;

  switch (toolName) {
    case 'Read':
      return `TOOL Read: ${input.file_path ?? 'unknown'}`;
    case 'Write':
      return `TOOL Write: ${input.file_path ?? 'unknown'}`;
    case 'Edit':
      return `TOOL Edit: ${input.file_path ?? 'unknown'}`;
    case 'Bash': {
      const cmd = String(input.command ?? '').substring(0, 100);
      return `TOOL Bash: ${cmd}`;
    }
    case 'Grep':
      return `TOOL Grep: "${input.pattern}" in ${input.path ?? '.'}`;
    case 'Glob':
      return `TOOL Glob: ${input.pattern}`;
    case 'Task':
      return `TOOL Task: ${input.description ?? input.prompt?.toString().substring(0, 50) ?? 'subagent'}`;
    case 'TodoWrite':
      return `TOOL TodoWrite: updating task list`;
    case 'WebFetch':
      return `TOOL WebFetch: ${input.url}`;
    case 'WebSearch':
      return `TOOL WebSearch: "${input.query}"`;
    default:
      return `TOOL ${toolName}`;
  }
};

/**
 * Formats relative time from session start
 */
const formatRelativeTime = (eventTime: string, sessionStart: string): string => {
  const start = new Date(sessionStart).getTime();
  const event = new Date(eventTime).getTime();
  const diffMs = event - start;
  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Summarizes events for the analysis prompt with rich context
 */
export const summarizeEvents = (events: Event[], sessionStart?: string): string => {
  const start = sessionStart ?? events[0]?.timestamp ?? '';

  // For very long sessions, be selective
  const maxEvents = 300;
  let selectedEvents: Array<{ event: Event; index: number }>;

  if (events.length > maxEvents) {
    // Always include: user messages, errors, git ops
    // Sample: tool calls (every 3rd), skip most assistant messages
    selectedEvents = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }, idx) => {
        if (event.type === 'user_message') return true;
        if (event.type === 'error') return true;
        if (event.type === 'git_op') return true;
        if (event.type === 'tool_call') return idx % 3 === 0;
        if (event.type === 'assistant_message') return idx % 5 === 0;
        return false;
      });
  } else {
    selectedEvents = events.map((event, index) => ({ event, index }));
  }

  const lines = selectedEvents.map(({ event, index }) => {
    const time = event.timestamp ? formatRelativeTime(event.timestamp, start) : '??:??';
    const detail = extractEventDetail(event);
    return `[${time}] #${index + 1} ${detail}`;
  });

  if (events.length > maxEvents) {
    return `Session has ${events.length} events (showing ${selectedEvents.length} key events):\n\n${lines.join('\n')}`;
  }

  return lines.join('\n');
};

/**
 * Builds the analysis prompt for a session
 */
export const buildAnalysisPrompt = (session: Session): ChatMessage[] => {
  const eventSummary = summarizeEvents(session.events, session.startTime);

  const systemPrompt = `You are an expert at analyzing Claude Code session logs to identify friction patterns. Analyze the timeline and identify:

**BLOCKERS** - Progress stalled on a problem:
- Same error appearing multiple times
- Repeated edits to the same file without success
- Multiple failed test runs
- User expressing frustration or asking to try different approach
Example: "Blocker at #15-28: 5 attempts to fix 'Cannot find module' error in app.ts, resolved by adding missing export"

**DECISIONS** - Significant technical choices:
- Choosing between alternatives (e.g., "use X instead of Y")
- Architectural decisions
- Changing implementation approach
Example: "Decision at #42: Switched from REST to GraphQL API based on user request"

**REWORK** - Revisiting completed work:
- Reverting changes (git revert, undoing edits)
- Re-implementing something that was done earlier
- User saying "actually, let's go back to..."
Example: "Rework at #85: Reverted authentication changes and re-implemented with JWT instead of sessions"

**GOAL_SHIFT** - Objective changed mid-session:
- User changing what they want
- Pivoting to a different task
- Abandoning current work for something else
Example: "Goal shift at #120: Abandoned API refactor to fix urgent production bug"

For each annotation provide:
- type: blocker | decision | rework | goal_shift
- eventIndex: the # number where this started
- summary: Specific description citing the actual content (file names, error messages, user requests)
- confidence: 0.0-1.0

Return ONLY a JSON array. Be selective - only flag genuine friction points, not normal development flow.`;

  const userPrompt = `Analyze this Claude Code session:

Project: ${session.folder}
Branch: ${session.branch || 'N/A'}
Duration: ${Math.round(session.durationMs / 60000)} minutes
Total Events: ${session.events.length}

Timeline:
${eventSummary}

Identify blockers, decisions, rework, and goal shifts. Return JSON array only.`;

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
