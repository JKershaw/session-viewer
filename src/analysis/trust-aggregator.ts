/**
 * Trust Aggregator
 *
 * Aggregates session trust analyses into the trust map.
 * Cross-references task characteristics with outcomes to find patterns.
 *
 * "Tasks touching the auth module need 3x more steering."
 * "Sessions over 45 minutes without steering usually succeed."
 * "Breakdown into >5 subtasks correlates with successful autonomous completion."
 */

import type {
  SessionTrustAnalysis,
  TrustAggregate,
  TrustMap,
  TrustPrediction,
  TrustFactor
} from '../types/index.js';

/**
 * Compute statistical confidence based on sample size.
 * Uses a sigmoid function: more samples = higher confidence.
 * - 5 samples: ~0.5 confidence
 * - 10 samples: ~0.73 confidence
 * - 20 samples: ~0.88 confidence
 * - 50 samples: ~0.98 confidence
 */
const computeConfidence = (sampleSize: number): number => {
  // Sigmoid: 1 / (1 + e^(-k(x - midpoint)))
  // k=0.2, midpoint=5 gives good scaling
  const k = 0.2;
  const midpoint = 5;
  return 1 / (1 + Math.exp(-k * (sampleSize - midpoint)));
};

/**
 * Group analyses by a key extractor and compute aggregates.
 */
const aggregateByKey = (
  analyses: SessionTrustAnalysis[],
  keyExtractor: (a: SessionTrustAnalysis) => string | null,
  categoryType: TrustAggregate['categoryType']
): TrustAggregate[] => {
  // Group by key
  const groups = new Map<string, SessionTrustAnalysis[]>();

  for (const analysis of analyses) {
    const key = keyExtractor(analysis);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(analysis);
  }

  // Compute aggregates for each group
  const aggregates: TrustAggregate[] = [];

  for (const [category, group] of groups) {
    const totalSessions = group.length;
    const autonomousSessions = group.filter(a => a.autonomous).length;

    // Compute averages
    const avgTrustScore = group.reduce((sum, a) => sum + a.trustScore, 0) / totalSessions;
    const avgInterventionCount = group.reduce((sum, a) => sum + a.steering.interventionCount, 0) / totalSessions;
    const avgInterventionDensity = group.reduce((sum, a) => sum + a.steering.interventionDensity, 0) / totalSessions;

    // Outcome rates
    const sessionsWithCommit = group.filter(a => a.outcome.hasCommit).length;
    const sessionsWithRework = group.filter(a => a.outcome.reworkCount > 0).length;
    const sessionsWithEndError = group.filter(a => a.outcome.endedWithError).length;

    // Average first intervention progress (excluding nulls)
    const interventionProgressValues = group
      .map(a => a.steering.firstInterventionProgress)
      .filter((v): v is number => v !== null);
    const avgFirstInterventionProgress = interventionProgressValues.length > 0
      ? interventionProgressValues.reduce((sum, v) => sum + v, 0) / interventionProgressValues.length
      : 0.5;  // Default to middle if no data

    aggregates.push({
      category,
      categoryType,
      totalSessions,
      autonomousSessions,
      autonomousRate: autonomousSessions / totalSessions,
      avgTrustScore,
      avgInterventionCount,
      avgInterventionDensity,
      commitRate: sessionsWithCommit / totalSessions,
      reworkRate: sessionsWithRework / totalSessions,
      errorRate: sessionsWithEndError / totalSessions,
      avgFirstInterventionProgress,
      confidence: computeConfidence(totalSessions),
      updatedAt: new Date().toISOString()
    });
  }

  // Sort by total sessions (most data first)
  return aggregates.sort((a, b) => b.totalSessions - a.totalSessions);
};

/**
 * Special aggregation for labels since sessions can have multiple labels.
 * Each session is counted once per label it has.
 */
const aggregateByLabels = (analyses: SessionTrustAnalysis[]): TrustAggregate[] => {
  // Group analyses by label
  const groups = new Map<string, SessionTrustAnalysis[]>();

  for (const analysis of analyses) {
    for (const label of analysis.characteristics.ticketLabels) {
      if (!groups.has(label)) {
        groups.set(label, []);
      }
      groups.get(label)!.push(analysis);
    }
  }

  // Use the same aggregation logic
  const aggregates: TrustAggregate[] = [];

  for (const [category, group] of groups) {
    const totalSessions = group.length;
    const autonomousSessions = group.filter(a => a.autonomous).length;
    const avgTrustScore = group.reduce((sum, a) => sum + a.trustScore, 0) / totalSessions;
    const avgInterventionCount = group.reduce((sum, a) => sum + a.steering.interventionCount, 0) / totalSessions;
    const avgInterventionDensity = group.reduce((sum, a) => sum + a.steering.interventionDensity, 0) / totalSessions;
    const sessionsWithCommit = group.filter(a => a.outcome.hasCommit).length;
    const sessionsWithRework = group.filter(a => a.outcome.reworkCount > 0).length;
    const sessionsWithEndError = group.filter(a => a.outcome.endedWithError).length;
    const interventionProgressValues = group
      .map(a => a.steering.firstInterventionProgress)
      .filter((v): v is number => v !== null);
    const avgFirstInterventionProgress = interventionProgressValues.length > 0
      ? interventionProgressValues.reduce((sum, v) => sum + v, 0) / interventionProgressValues.length
      : 0.5;

    aggregates.push({
      category,
      categoryType: 'label',
      totalSessions,
      autonomousSessions,
      autonomousRate: autonomousSessions / totalSessions,
      avgTrustScore,
      avgInterventionCount,
      avgInterventionDensity,
      commitRate: sessionsWithCommit / totalSessions,
      reworkRate: sessionsWithRework / totalSessions,
      errorRate: sessionsWithEndError / totalSessions,
      avgFirstInterventionProgress,
      confidence: computeConfidence(totalSessions),
      updatedAt: new Date().toISOString()
    });
  }

  return aggregates.sort((a, b) => b.totalSessions - a.totalSessions);
};

/**
 * Build the complete trust map from session analyses.
 */
export const buildTrustMap = (analyses: SessionTrustAnalysis[]): TrustMap => {
  if (analyses.length === 0) {
    return {
      byArea: [],
      byTicketType: [],
      byBranchType: [],
      byLabel: [],
      byProject: [],
      global: {
        totalSessions: 0,
        autonomousRate: 0,
        avgTrustScore: 0,
        avgInterventionCount: 0
      },
      computedAt: new Date().toISOString()
    };
  }

  // Aggregate by different dimensions
  const byArea = aggregateByKey(
    analyses,
    a => a.characteristics.codebaseArea,
    'area'
  );

  const byTicketType = aggregateByKey(
    analyses,
    a => a.characteristics.ticketType,
    'ticketType'
  );

  const byBranchType = aggregateByKey(
    analyses,
    a => a.characteristics.branchType,
    'branchType'
  );

  // Labels need special handling (one session can have multiple)
  // Create a separate aggregation for labels
  const byLabel = aggregateByLabels(analyses);

  // By project (folder path)
  const byProject = aggregateByKey(
    analyses,
    a => a.characteristics.projectPath,
    'project'
  );

  // Global statistics
  const totalSessions = analyses.length;
  const autonomousSessions = analyses.filter(a => a.autonomous).length;
  const global = {
    totalSessions,
    autonomousRate: autonomousSessions / totalSessions,
    avgTrustScore: analyses.reduce((sum, a) => sum + a.trustScore, 0) / totalSessions,
    avgInterventionCount: analyses.reduce((sum, a) => sum + a.steering.interventionCount, 0) / totalSessions
  };

  return {
    byArea,
    byTicketType,
    byBranchType,
    byLabel,
    byProject,
    global,
    computedAt: new Date().toISOString()
  };
};

/**
 * Find matching aggregate for a value, with fallback.
 */
const findAggregate = (
  aggregates: TrustAggregate[],
  value: string | null
): TrustAggregate | null => {
  if (!value) return null;
  return aggregates.find(a => a.category === value) ?? null;
};

/**
 * Predict trust level for a new task based on its characteristics.
 */
export const predictTrust = (
  trustMap: TrustMap,
  characteristics: {
    codebaseArea?: string;
    ticketType?: string;
    branchType?: string;
    labels?: string[];
    projectPath?: string;
  }
): TrustPrediction => {
  const factors: TrustFactor[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  // Check area match
  if (characteristics.codebaseArea) {
    const areaAgg = findAggregate(trustMap.byArea, characteristics.codebaseArea);
    if (areaAgg && areaAgg.totalSessions >= 3) {
      const weight = areaAgg.confidence;
      weightedSum += areaAgg.avgTrustScore * weight;
      totalWeight += weight;

      factors.push({
        source: `area:${areaAgg.category}`,
        trustLevel: areaAgg.avgTrustScore,
        weight,
        sampleSize: areaAgg.totalSessions,
        insight: generateInsight(areaAgg, 'area')
      });
    }
  }

  // Check ticket type match
  if (characteristics.ticketType) {
    const typeAgg = findAggregate(trustMap.byTicketType, characteristics.ticketType);
    if (typeAgg && typeAgg.totalSessions >= 3) {
      const weight = typeAgg.confidence * 0.8;  // Slightly lower weight
      weightedSum += typeAgg.avgTrustScore * weight;
      totalWeight += weight;

      factors.push({
        source: `type:${typeAgg.category}`,
        trustLevel: typeAgg.avgTrustScore,
        weight,
        sampleSize: typeAgg.totalSessions,
        insight: generateInsight(typeAgg, 'ticketType')
      });
    }
  }

  // Check branch type match
  if (characteristics.branchType) {
    const branchAgg = findAggregate(trustMap.byBranchType, characteristics.branchType);
    if (branchAgg && branchAgg.totalSessions >= 3) {
      const weight = branchAgg.confidence * 0.6;
      weightedSum += branchAgg.avgTrustScore * weight;
      totalWeight += weight;

      factors.push({
        source: `branch:${branchAgg.category}`,
        trustLevel: branchAgg.avgTrustScore,
        weight,
        sampleSize: branchAgg.totalSessions,
        insight: generateInsight(branchAgg, 'branchType')
      });
    }
  }

  // Check label matches
  if (characteristics.labels?.length) {
    for (const label of characteristics.labels) {
      const labelAgg = findAggregate(trustMap.byLabel, label);
      if (labelAgg && labelAgg.totalSessions >= 3) {
        const weight = labelAgg.confidence * 0.5;
        weightedSum += labelAgg.avgTrustScore * weight;
        totalWeight += weight;

        factors.push({
          source: `label:${labelAgg.category}`,
          trustLevel: labelAgg.avgTrustScore,
          weight,
          sampleSize: labelAgg.totalSessions,
          insight: generateInsight(labelAgg, 'label')
        });
      }
    }
  }

  // Compute final prediction
  let predictedTrustScore: number;
  let confidenceScore: number;

  if (totalWeight > 0) {
    predictedTrustScore = weightedSum / totalWeight;
    confidenceScore = Math.min(totalWeight / 2, 1);  // Max out at ~2 total weight
  } else {
    // Fall back to global baseline
    predictedTrustScore = trustMap.global.avgTrustScore;
    confidenceScore = 0.3;  // Low confidence without specific matches
  }

  // Categorize trust level
  let predictedTrust: 'high' | 'medium' | 'low';
  if (predictedTrustScore >= 0.7) {
    predictedTrust = 'high';
  } else if (predictedTrustScore >= 0.4) {
    predictedTrust = 'medium';
  } else {
    predictedTrust = 'low';
  }

  // Generate recommendation
  const { recommendation, suggestedApproach } = generateRecommendation(
    predictedTrust,
    factors,
    trustMap.global
  );

  return {
    predictedTrust,
    confidenceScore,
    factors: factors.sort((a, b) => b.weight - a.weight),
    recommendation,
    suggestedApproach
  };
};

/**
 * Generate human-readable insight from an aggregate.
 */
const generateInsight = (
  agg: TrustAggregate,
  type: TrustAggregate['categoryType']
): string => {
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const typeLabels: Record<string, string> = {
    area: 'This area',
    ticketType: 'This ticket type',
    branchType: 'This branch type',
    label: 'This label',
    project: 'This project'
  };

  const prefix = typeLabels[type] || 'This category';

  if (agg.autonomousRate >= 0.8) {
    return `${prefix}: ${pct(agg.autonomousRate)} unsteered completion rate across ${agg.totalSessions} sessions`;
  } else if (agg.autonomousRate <= 0.3) {
    return `${prefix}: needs attention. Only ${pct(agg.autonomousRate)} autonomous, avg ${agg.avgInterventionCount.toFixed(1)} interventions`;
  } else if (agg.reworkRate > 0.3) {
    return `${prefix}: ${pct(agg.reworkRate)} rework rate. Extra review recommended`;
  } else {
    return `${prefix}: ${pct(agg.autonomousRate)} autonomous, ${pct(agg.commitRate)} commit rate`;
  }
};

/**
 * Generate recommendation based on prediction.
 */
const generateRecommendation = (
  trustLevel: 'high' | 'medium' | 'low',
  factors: TrustFactor[],
  global: TrustMap['global']
): { recommendation: string; suggestedApproach: TrustPrediction['suggestedApproach'] } => {
  // Find concerning factors
  const lowTrustFactors = factors.filter(f => f.trustLevel < 0.4);
  const highTrustFactors = factors.filter(f => f.trustLevel >= 0.7);

  if (trustLevel === 'high') {
    return {
      recommendation: highTrustFactors.length > 0
        ? `High confidence. ${highTrustFactors[0].insight}`
        : 'Based on similar tasks, this should run smoothly with minimal oversight.',
      suggestedApproach: 'autonomous'
    };
  }

  if (trustLevel === 'low') {
    const warning = lowTrustFactors.length > 0
      ? lowTrustFactors[0].insight
      : `Historical average: ${global.avgInterventionCount.toFixed(1)} interventions per session`;

    return {
      recommendation: `Proceed with caution. ${warning}. Consider breaking into smaller subtasks.`,
      suggestedApproach: 'detailed_breakdown'
    };
  }

  // Medium trust
  return {
    recommendation: 'Moderate confidence. Light monitoring recommended.',
    suggestedApproach: 'light_monitoring'
  };
};

/**
 * Generate insights comparing an aggregate to the global baseline.
 */
export const generateComparativeInsights = (
  trustMap: TrustMap
): string[] => {
  const insights: string[] = [];
  const global = trustMap.global;

  // Find outliers in each category
  const analyzeCategory = (
    aggregates: TrustAggregate[],
    categoryName: string
  ) => {
    for (const agg of aggregates) {
      if (agg.totalSessions < 5) continue;  // Need enough data

      // Significantly lower autonomous rate
      if (agg.autonomousRate < global.autonomousRate - 0.2) {
        const multiplier = global.avgInterventionCount > 0
          ? (agg.avgInterventionCount / global.avgInterventionCount).toFixed(1)
          : '?';
        insights.push(
          `${categoryName} "${agg.category}" needs ${multiplier}x more steering than average`
        );
      }

      // Significantly higher autonomous rate
      if (agg.autonomousRate > global.autonomousRate + 0.2) {
        insights.push(
          `${categoryName} "${agg.category}": ${Math.round(agg.autonomousRate * 100)}% autonomous completion`
        );
      }

      // High rework rate
      if (agg.reworkRate > 0.3 && agg.reworkRate > global.autonomousRate * 0.5) {
        insights.push(
          `${categoryName} "${agg.category}" has ${Math.round(agg.reworkRate * 100)}% rework rate`
        );
      }
    }
  };

  analyzeCategory(trustMap.byArea, 'Area');
  analyzeCategory(trustMap.byTicketType, 'Ticket type');
  analyzeCategory(trustMap.byBranchType, 'Branch type');
  analyzeCategory(trustMap.byLabel, 'Label');

  return insights;
};
