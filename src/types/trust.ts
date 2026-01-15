/**
 * Trust Analysis Types
 *
 * The trust map is built empirically from session data:
 * - Steering = user interventions (messages mid-session)
 * - Outcome = completion quality (commits, rework, errors)
 * - Characteristics = task features (area, type, complexity)
 */

/**
 * Steering metrics extracted from a session.
 * Every user message after the first is an intervention.
 */
export interface SteeringMetrics {
  // Count of user interventions (messages after initial prompt)
  interventionCount: number;

  // When did steering happen relative to session progress?
  // 0 = start, 1 = end. Early intervention often indicates low trust.
  firstInterventionProgress: number | null;

  // Intervention density: interventions per 10k tokens
  interventionDensity: number;

  // Goal shifts detected by LLM analysis
  goalShiftCount: number;

  // Time from session start to first intervention (ms)
  timeToFirstIntervention: number | null;
}

/**
 * Task characteristics that predict trust requirements.
 */
export interface TaskCharacteristics {
  // Normalized codebase area (e.g., "src/auth", "tests", "config")
  codebaseArea: string;

  // Project folder path
  projectPath: string;

  // Git branch pattern (feature/, fix/, etc.)
  branchType: string | null;

  // Linear ticket metadata
  ticketType: string | null;
  ticketLabels: string[];

  // Complexity signals from the task
  initialPromptTokens: number;
  subtaskCount: number;  // Planning mode breakdowns
  toolDiversity: number; // Unique tools used

  // Files/areas touched (extracted from tool calls)
  filePatterns: string[];
}

/**
 * Outcome metrics that indicate success or friction.
 */
export interface OutcomeMetrics {
  // Did the session produce commits?
  hasCommit: boolean;
  commitCount: number;

  // Did it push to remote?
  hasPush: boolean;

  // Friction indicators from LLM analysis
  blockerCount: number;
  reworkCount: number;
  decisionCount: number;

  // Error frequency
  errorCount: number;
  errorDensity: number;  // Errors per 10k tokens

  // Session completion signals
  durationMs: number;
  totalTokens: number;

  // Did it end cleanly or with errors?
  endedWithError: boolean;
}

/**
 * Complete trust analysis for a single session.
 */
export interface SessionTrustAnalysis {
  sessionId: string;
  analyzedAt: string;

  steering: SteeringMetrics;
  characteristics: TaskCharacteristics;
  outcome: OutcomeMetrics;

  // Computed trust score (0-1, higher = more autonomous)
  // Based on: low steering + good outcomes
  trustScore: number;

  // Was this session "unsteered"? (0-1 interventions)
  autonomous: boolean;

  // Index signature for MangoDB compatibility
  [key: string]: unknown;
}

/**
 * Aggregated trust statistics for a category.
 * Categories can be: codebase area, ticket type, branch pattern, etc.
 */
export interface TrustAggregate {
  category: string;      // The grouping key (e.g., "src/auth", "bug", "feature/")
  categoryType: 'area' | 'ticketType' | 'branchType' | 'label' | 'project';

  // Session counts
  totalSessions: number;
  autonomousSessions: number;  // Sessions with <=1 intervention

  // Derived metrics
  autonomousRate: number;      // autonomousSessions / totalSessions
  avgTrustScore: number;
  avgInterventionCount: number;
  avgInterventionDensity: number;

  // Outcome rates
  commitRate: number;          // Sessions with commits
  reworkRate: number;          // Sessions with rework annotations
  errorRate: number;           // Sessions ending with errors

  // Steering patterns
  avgFirstInterventionProgress: number;  // When do people step in?

  // Sample size confidence (more sessions = more reliable)
  confidence: number;          // Statistical confidence based on sample size

  // Last updated
  updatedAt: string;
}

/**
 * The trust map: aggregated trust data across all categories.
 */
export interface TrustMap {
  // Trust by codebase area
  byArea: TrustAggregate[];

  // Trust by ticket type
  byTicketType: TrustAggregate[];

  // Trust by branch pattern
  byBranchType: TrustAggregate[];

  // Trust by label
  byLabel: TrustAggregate[];

  // Trust by project
  byProject: TrustAggregate[];

  // Global baseline
  global: {
    totalSessions: number;
    autonomousRate: number;
    avgTrustScore: number;
    avgInterventionCount: number;
  };

  // When was this map last computed?
  computedAt: string;

  // Index signature for MangoDB compatibility
  [key: string]: unknown;
}

/**
 * Trust prediction for a new task.
 * Based on matching characteristics against the trust map.
 */
export interface TrustPrediction {
  // Overall predicted trust level
  predictedTrust: 'high' | 'medium' | 'low';
  confidenceScore: number;  // 0-1, based on how much matching data we have

  // Breakdown by matching factors
  factors: TrustFactor[];

  // Recommendation
  recommendation: string;
  suggestedApproach: 'autonomous' | 'light_monitoring' | 'active_steering' | 'detailed_breakdown';
}

export interface TrustFactor {
  source: string;       // What matched (e.g., "area:src/auth", "type:bug")
  trustLevel: number;   // 0-1
  weight: number;       // How much this factor contributes
  sampleSize: number;   // How many sessions informed this
  insight: string;      // Human-readable insight
}
