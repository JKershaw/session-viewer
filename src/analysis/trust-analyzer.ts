/**
 * Trust Analyzer
 *
 * Extracts steering signals, task characteristics, and outcomes from sessions
 * to build the empirical trust map.
 *
 * Key insight: Every user intervention is a label. The steering log IS the ground truth.
 */

import type {
  Session,
  Event,
  Annotation,
  SteeringMetrics,
  TaskCharacteristics,
  OutcomeMetrics,
  SessionTrustAnalysis
} from '../types/index.js';
import { extractContent, extractBashCommand, extractGitDetails } from '../parser/events.js';

/**
 * Extract steering metrics from session events.
 * Steering = user messages after the initial prompt.
 */
export const extractSteeringMetrics = (session: Session): SteeringMetrics => {
  const events = session.events;
  const annotations = session.annotations || [];

  // Find all user messages
  const userMessages = events.filter(e => e.type === 'user_message');

  // First message is the initial prompt, rest are interventions
  const interventionCount = Math.max(0, userMessages.length - 1);

  // Calculate when first intervention happened
  let firstInterventionProgress: number | null = null;
  let timeToFirstIntervention: number | null = null;

  if (interventionCount > 0 && userMessages.length > 1) {
    const sessionStart = new Date(session.startTime).getTime();
    const sessionEnd = new Date(session.endTime).getTime();
    const sessionDuration = sessionEnd - sessionStart;

    // Second user message is the first intervention
    const firstIntervention = userMessages[1];
    const interventionTime = new Date(firstIntervention.timestamp).getTime();

    timeToFirstIntervention = interventionTime - sessionStart;

    if (sessionDuration > 0) {
      firstInterventionProgress = timeToFirstIntervention / sessionDuration;
    }
  }

  // Intervention density: interventions per 10k tokens
  const interventionDensity = session.totalTokens > 0
    ? (interventionCount / session.totalTokens) * 10000
    : 0;

  // Count goal shifts from annotations
  const goalShiftCount = annotations.filter(a => a.type === 'goal_shift').length;

  return {
    interventionCount,
    firstInterventionProgress,
    interventionDensity,
    goalShiftCount,
    timeToFirstIntervention
  };
};

/**
 * Normalize a file path to a codebase area.
 * e.g., "/home/user/project/src/auth/login.ts" -> "src/auth"
 */
const normalizeToArea = (path: string, projectRoot: string): string => {
  // Remove project root to get relative path
  let relativePath = path;
  if (path.startsWith(projectRoot)) {
    relativePath = path.slice(projectRoot.length).replace(/^\//, '');
  }

  // Extract the first 2 path segments as the "area"
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) return 'root';
  if (segments.length === 1) return segments[0];
  return `${segments[0]}/${segments[1]}`;
};

/**
 * Extract file paths from tool calls.
 */
const extractFilePaths = (events: Event[]): string[] => {
  const paths = new Set<string>();

  for (const event of events) {
    if (event.type !== 'tool_call') continue;

    const raw = event.raw;
    const input = raw.input as Record<string, unknown> | undefined;

    // Common file path parameters
    const fileFields = ['file_path', 'path', 'filePath', 'filename'];
    for (const field of fileFields) {
      if (input?.[field] && typeof input[field] === 'string') {
        paths.add(input[field] as string);
      }
    }

    // Glob patterns
    if (input?.pattern && typeof input.pattern === 'string') {
      // Extract directory from glob pattern
      const pattern = input.pattern as string;
      const dir = pattern.split('*')[0].replace(/\/$/, '');
      if (dir) paths.add(dir);
    }
  }

  return Array.from(paths);
};

/**
 * Extract unique tools used in a session.
 */
const extractUniqueTools = (events: Event[]): string[] => {
  const tools = new Set<string>();

  for (const event of events) {
    if (event.type === 'tool_call' || event.type === 'git_op') {
      const raw = event.raw;
      const toolName = (raw.tool_name ?? raw.name ?? 'unknown') as string;
      tools.add(toolName);
    }
  }

  return Array.from(tools);
};

/**
 * Classify branch type from branch name.
 */
const classifyBranchType = (branch: string | null): string | null => {
  if (!branch) return null;

  const patterns: [RegExp, string][] = [
    [/^feature[/-]/i, 'feature'],
    [/^fix[/-]/i, 'fix'],
    [/^bug[/-]/i, 'bugfix'],
    [/^hotfix[/-]/i, 'hotfix'],
    [/^release[/-]/i, 'release'],
    [/^refactor[/-]/i, 'refactor'],
    [/^test[/-]/i, 'test'],
    [/^docs?[/-]/i, 'docs'],
    [/^chore[/-]/i, 'chore'],
    [/^claude[/-]/i, 'claude'],  // Claude-generated branches
    [/^(main|master|develop)$/i, 'main'],
  ];

  for (const [pattern, type] of patterns) {
    if (pattern.test(branch)) return type;
  }

  return 'other';
};

/**
 * Count planning/subtask breakdowns in events.
 */
const countSubtasks = (events: Event[]): number => {
  let count = 0;

  for (const event of events) {
    if (event.type !== 'planning_mode') continue;

    const content = extractContent(event.raw);
    if (!content) continue;

    // Count numbered steps, bullet points, or "step X" patterns
    const stepPatterns = [
      /^\s*\d+\./gm,           // "1. First step"
      /^\s*[-*]\s+/gm,         // "- Do this"
      /\bstep\s+\d+/gi,        // "Step 1:"
    ];

    for (const pattern of stepPatterns) {
      const matches = content.match(pattern);
      if (matches) count += matches.length;
    }
  }

  return count;
};

/**
 * Extract task characteristics from session.
 */
export const extractTaskCharacteristics = (
  session: Session,
  ticketType?: string | null,
  ticketLabels?: string[]
): TaskCharacteristics => {
  const events = session.events;

  // Get initial prompt token count (first user message)
  const firstUserMessage = events.find(e => e.type === 'user_message');
  const initialPromptTokens = firstUserMessage?.tokenCount ?? 0;

  // Extract file paths and normalize to areas
  const filePaths = extractFilePaths(events);
  const areas = filePaths.map(p => normalizeToArea(p, session.folder));
  const uniqueAreas = [...new Set(areas)];

  // Primary codebase area (most common)
  const areaCounts = new Map<string, number>();
  for (const area of areas) {
    areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
  }
  const sortedAreas = [...areaCounts.entries()].sort((a, b) => b[1] - a[1]);
  const codebaseArea = sortedAreas[0]?.[0] || 'unknown';

  // Extract unique tools
  const tools = extractUniqueTools(events);

  // Count subtask breakdowns
  const subtaskCount = countSubtasks(events);

  // Extract file patterns (directories and extensions)
  const filePatterns = uniqueAreas.slice(0, 10);  // Top 10 areas

  return {
    codebaseArea,
    projectPath: session.folder,
    branchType: classifyBranchType(session.branch),
    ticketType: ticketType ?? null,
    ticketLabels: ticketLabels ?? [],
    initialPromptTokens,
    subtaskCount,
    toolDiversity: tools.length,
    filePatterns
  };
};

/**
 * Extract outcome metrics from session.
 */
export const extractOutcomeMetrics = (session: Session): OutcomeMetrics => {
  const events = session.events;
  const annotations = session.annotations || [];

  // Count git operations
  const gitOps = events.filter(e => e.type === 'git_op');
  let commitCount = 0;
  let hasPush = false;

  for (const gitEvent of gitOps) {
    const details = extractGitDetails(gitEvent);
    if (!details) continue;

    if (details.operation === 'commit') commitCount++;
    if (details.operation === 'push') hasPush = true;
  }

  // Count errors
  const errors = events.filter(e => e.type === 'error');
  const errorCount = errors.length;
  const errorDensity = session.totalTokens > 0
    ? (errorCount / session.totalTokens) * 10000
    : 0;

  // Check if session ended with error
  const lastEvents = events.slice(-5);
  const endedWithError = lastEvents.some(e => e.type === 'error');

  // Count friction from annotations
  const blockerCount = annotations.filter(a => a.type === 'blocker').length;
  const reworkCount = annotations.filter(a => a.type === 'rework').length;
  const decisionCount = annotations.filter(a => a.type === 'decision').length;

  return {
    hasCommit: commitCount > 0,
    commitCount,
    hasPush,
    blockerCount,
    reworkCount,
    decisionCount,
    errorCount,
    errorDensity,
    durationMs: session.durationMs,
    totalTokens: session.totalTokens,
    endedWithError
  };
};

/**
 * Compute trust score from steering and outcome metrics.
 *
 * High trust = low steering + good outcomes
 * Score is 0-1, higher = more autonomous success
 */
export const computeTrustScore = (
  steering: SteeringMetrics,
  outcome: OutcomeMetrics
): number => {
  // Factors that INCREASE trust (autonomous success signals)
  let score = 0.5;  // Start at neutral

  // Low intervention is good (+0.2 for 0 interventions, scaling down)
  const interventionPenalty = Math.min(steering.interventionCount * 0.1, 0.3);
  score -= interventionPenalty;

  // No goal shifts is good (+0.1)
  if (steering.goalShiftCount === 0) {
    score += 0.1;
  } else {
    score -= Math.min(steering.goalShiftCount * 0.05, 0.15);
  }

  // Commits are good (+0.15 for having commits)
  if (outcome.hasCommit) {
    score += 0.15;
  }

  // Push to remote is very good (+0.1)
  if (outcome.hasPush) {
    score += 0.1;
  }

  // No rework is good (+0.1)
  if (outcome.reworkCount === 0) {
    score += 0.1;
  } else {
    score -= Math.min(outcome.reworkCount * 0.1, 0.2);
  }

  // Low blockers is good
  score -= Math.min(outcome.blockerCount * 0.05, 0.15);

  // No errors at end is good (+0.05)
  if (!outcome.endedWithError) {
    score += 0.05;
  } else {
    score -= 0.1;
  }

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, score));
};

/**
 * Analyze a session and produce complete trust metrics.
 */
export const analyzeSessionTrust = (
  session: Session,
  ticketType?: string | null,
  ticketLabels?: string[]
): SessionTrustAnalysis => {
  const steering = extractSteeringMetrics(session);
  const characteristics = extractTaskCharacteristics(session, ticketType, ticketLabels);
  const outcome = extractOutcomeMetrics(session);
  const trustScore = computeTrustScore(steering, outcome);

  // A session is "autonomous" if it had 0-1 user interventions
  const autonomous = steering.interventionCount <= 1;

  return {
    sessionId: session.id,
    analyzedAt: new Date().toISOString(),
    steering,
    characteristics,
    outcome,
    trustScore,
    autonomous
  };
};

/**
 * Batch analyze multiple sessions.
 */
export const analyzeSessionsTrust = (
  sessions: Session[],
  ticketMap?: Map<string, { type: string; labels: string[] }>
): SessionTrustAnalysis[] => {
  return sessions.map(session => {
    const ticket = session.linearTicketId
      ? ticketMap?.get(session.linearTicketId)
      : undefined;
    return analyzeSessionTrust(session, ticket?.type, ticket?.labels);
  });
};
