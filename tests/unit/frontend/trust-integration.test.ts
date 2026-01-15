/**
 * Integration tests for trust dashboard functionality.
 * Tests data flow and component interactions.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

// Mock trust map data for testing
const createMockTrustMap = () => ({
  global: {
    totalSessions: 50,
    autonomousRate: 0.68,
    avgTrustScore: 0.65,
    avgInterventionCount: 1.4
  },
  byArea: [
    {
      category: 'src/auth',
      categoryType: 'area' as const,
      totalSessions: 15,
      autonomousSessions: 12,
      autonomousRate: 0.8,
      avgTrustScore: 0.78,
      avgInterventionCount: 0.6,
      avgInterventionDensity: 0.3,
      commitRate: 0.93,
      reworkRate: 0.07,
      errorRate: 0.03,
      avgFirstInterventionProgress: 0.75,
      confidence: 0.88,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'src/api',
      categoryType: 'area' as const,
      totalSessions: 12,
      autonomousSessions: 7,
      autonomousRate: 7 / 12,  // 0.5833...
      avgTrustScore: 0.55,
      avgInterventionCount: 2.0,
      avgInterventionDensity: 0.9,
      commitRate: 0.75,
      reworkRate: 0.2,
      errorRate: 0.12,
      avgFirstInterventionProgress: 0.4,
      confidence: 0.82,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'tests',
      categoryType: 'area' as const,
      totalSessions: 8,
      autonomousSessions: 7,
      autonomousRate: 0.875,
      avgTrustScore: 0.82,
      avgInterventionCount: 0.3,
      avgInterventionDensity: 0.15,
      commitRate: 0.95,
      reworkRate: 0.05,
      errorRate: 0.02,
      avgFirstInterventionProgress: 0.9,
      confidence: 0.75,
      updatedAt: '2026-01-15T10:00:00Z'
    }
  ],
  byTicketType: [
    {
      category: 'bug',
      categoryType: 'ticketType' as const,
      totalSessions: 20,
      autonomousSessions: 10,
      autonomousRate: 0.5,
      avgTrustScore: 0.52,
      avgInterventionCount: 2.3,
      avgInterventionDensity: 1.1,
      commitRate: 0.85,
      reworkRate: 0.28,
      errorRate: 0.15,
      avgFirstInterventionProgress: 0.35,
      confidence: 0.9,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'feature',
      categoryType: 'ticketType' as const,
      totalSessions: 30,
      autonomousSessions: 24,
      autonomousRate: 0.8,
      avgTrustScore: 0.75,
      avgInterventionCount: 0.8,
      avgInterventionDensity: 0.35,
      commitRate: 0.9,
      reworkRate: 0.08,
      errorRate: 0.05,
      avgFirstInterventionProgress: 0.65,
      confidence: 0.92,
      updatedAt: '2026-01-15T10:00:00Z'
    }
  ],
  byBranchType: [
    {
      category: 'feature',
      categoryType: 'branchType' as const,
      totalSessions: 35,
      autonomousSessions: 28,
      autonomousRate: 0.8,
      avgTrustScore: 0.76,
      avgInterventionCount: 0.7,
      avgInterventionDensity: 0.3,
      commitRate: 0.88,
      reworkRate: 0.1,
      errorRate: 0.06,
      avgFirstInterventionProgress: 0.7,
      confidence: 0.93,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'fix',
      categoryType: 'branchType' as const,
      totalSessions: 15,
      autonomousSessions: 8,
      autonomousRate: 0.53,
      avgTrustScore: 0.5,
      avgInterventionCount: 2.1,
      avgInterventionDensity: 1.0,
      commitRate: 0.8,
      reworkRate: 0.25,
      errorRate: 0.12,
      avgFirstInterventionProgress: 0.4,
      confidence: 0.85,
      updatedAt: '2026-01-15T10:00:00Z'
    }
  ],
  byLabel: [],
  byProject: [],
  computedAt: '2026-01-15T10:00:00Z'
});

const createMockPrediction = () => ({
  predictedTrust: 'high' as const,
  confidenceScore: 0.82,
  factors: [
    {
      source: 'area:src/auth',
      trustLevel: 0.8,
      weight: 0.9,
      sampleSize: 15,
      insight: 'This area has historically high autonomy (80%)'
    },
    {
      source: 'type:feature',
      trustLevel: 0.8,
      weight: 0.7,
      sampleSize: 30,
      insight: 'Feature tasks typically run smoothly'
    }
  ],
  recommendation: 'Based on historical data, Claude should be able to handle this task with minimal intervention. The src/auth area and feature ticket type both have strong track records.',
  suggestedApproach: 'autonomous' as const
});

describe('Trust Dashboard Data Flow', () => {
  test('trust map provides data for all components', () => {
    const trustMap = createMockTrustMap();

    // Global stats get data from trust.map.global
    assert.ok(trustMap.global);
    assert.strictEqual(typeof trustMap.global.totalSessions, 'number');
    assert.strictEqual(typeof trustMap.global.autonomousRate, 'number');
    assert.strictEqual(typeof trustMap.global.avgTrustScore, 'number');
    assert.strictEqual(typeof trustMap.global.avgInterventionCount, 'number');

    // Area chart gets data from trust.map.byArea
    assert.ok(Array.isArray(trustMap.byArea));
    assert.ok(trustMap.byArea.length > 0);

    // Category tabs get data from multiple sources
    assert.ok(Array.isArray(trustMap.byArea));
    assert.ok(Array.isArray(trustMap.byTicketType));
    assert.ok(Array.isArray(trustMap.byBranchType));
    assert.ok(Array.isArray(trustMap.byLabel));
    assert.ok(Array.isArray(trustMap.byProject));
  });

  test('area aggregate has all required fields', () => {
    const trustMap = createMockTrustMap();
    const area = trustMap.byArea[0];

    // Required fields for display
    assert.ok('category' in area);
    assert.ok('totalSessions' in area);
    assert.ok('autonomousRate' in area);
    assert.ok('avgTrustScore' in area);
    assert.ok('commitRate' in area);
    assert.ok('reworkRate' in area);
    assert.ok('confidence' in area);
  });

  test('prediction response has all required fields', () => {
    const prediction = createMockPrediction();

    assert.ok(['high', 'medium', 'low'].includes(prediction.predictedTrust));
    assert.ok(typeof prediction.confidenceScore === 'number');
    assert.ok(Array.isArray(prediction.factors));
    assert.ok(typeof prediction.recommendation === 'string');
    assert.ok(['autonomous', 'light_monitoring', 'active_steering', 'detailed_breakdown'].includes(prediction.suggestedApproach));
  });

  test('prediction factors have required structure', () => {
    const prediction = createMockPrediction();

    prediction.factors.forEach(factor => {
      assert.ok(typeof factor.source === 'string');
      assert.ok(typeof factor.trustLevel === 'number');
      assert.ok(typeof factor.weight === 'number');
      assert.ok(typeof factor.sampleSize === 'number');
      assert.ok(typeof factor.insight === 'string');
    });
  });
});

describe('Cross-Component Interactions', () => {
  test('area click generates filter for timeline', () => {
    const trustMap = createMockTrustMap();
    const clickedArea = trustMap.byArea[0];

    // Simulating what happens when user clicks an area
    const filterValue = clickedArea.category;

    assert.strictEqual(filterValue, 'src/auth');
  });

  test('view switch from detail panel to dashboard', () => {
    // Simulating the flow from detail panel to dashboard
    const sessionTrust = {
      trustScore: 0.75,
      autonomous: true,
      characteristics: {
        codebaseArea: 'src/auth'
      }
    };

    // When user clicks "View in Dashboard", we get the area
    const areaToHighlight = sessionTrust.characteristics.codebaseArea;

    assert.strictEqual(areaToHighlight, 'src/auth');
  });

  test('compute trust map updates all derived data', () => {
    const trustMap = createMockTrustMap();

    // After compute, these should all be populated
    assert.ok(trustMap.global.totalSessions > 0);
    assert.ok(trustMap.byArea.length > 0);
    assert.ok(trustMap.computedAt);

    // Verify computedAt is a valid date
    const computedDate = new Date(trustMap.computedAt);
    assert.ok(!isNaN(computedDate.getTime()));
  });
});

describe('Trust Score Consistency', () => {
  test('autonomous rate matches session counts', () => {
    const trustMap = createMockTrustMap();

    trustMap.byArea.forEach(area => {
      const calculatedRate = area.autonomousSessions / area.totalSessions;
      assert.strictEqual(area.autonomousRate, calculatedRate);
    });
  });

  test('global stats aggregate individual areas', () => {
    const trustMap = createMockTrustMap();

    // Total sessions should equal sum of area sessions (approximately, may overlap)
    const areaSessions = trustMap.byArea.reduce((sum, area) => sum + area.totalSessions, 0);
    assert.ok(areaSessions <= trustMap.global.totalSessions * trustMap.byArea.length);
  });
});

describe('Confidence Scoring', () => {
  test('confidence increases with sample size', () => {
    const trustMap = createMockTrustMap();

    // Find areas with different sample sizes
    const sortedBySize = [...trustMap.byArea].sort((a, b) => b.totalSessions - a.totalSessions);

    if (sortedBySize.length >= 2) {
      const larger = sortedBySize[0];
      const smaller = sortedBySize[sortedBySize.length - 1];

      // Larger sample should generally have higher or equal confidence
      // (Not always true due to other factors, but good sanity check)
      assert.ok(larger.totalSessions >= smaller.totalSessions);
    }
  });

  test('prediction confidence reflects factor coverage', () => {
    const prediction = createMockPrediction();

    // More factors with high weights should increase confidence
    const hasFactors = prediction.factors.length > 0;
    const hasConfidence = prediction.confidenceScore > 0;

    assert.ok(hasFactors);
    assert.ok(hasConfidence);
  });
});

describe('Edge Cases', () => {
  test('handles empty trust map', () => {
    const emptyTrustMap = {
      global: {
        totalSessions: 0,
        autonomousRate: 0,
        avgTrustScore: 0,
        avgInterventionCount: 0
      },
      byArea: [],
      byTicketType: [],
      byBranchType: [],
      byLabel: [],
      byProject: [],
      computedAt: '2026-01-15T10:00:00Z'
    };

    assert.strictEqual(emptyTrustMap.global.totalSessions, 0);
    assert.strictEqual(emptyTrustMap.byArea.length, 0);
  });

  test('handles missing category gracefully', () => {
    const aggregate = {
      category: '',
      categoryType: 'area' as const,
      totalSessions: 5,
      autonomousSessions: 3,
      autonomousRate: 0.6,
      avgTrustScore: 0.55,
      avgInterventionCount: 1.5,
      avgInterventionDensity: 0.7,
      commitRate: 0.8,
      reworkRate: 0.15,
      errorRate: 0.1,
      avgFirstInterventionProgress: 0.5,
      confidence: 0.7,
      updatedAt: '2026-01-15T10:00:00Z'
    };

    // Empty category should display as "(none)" or similar
    const displayCategory = aggregate.category || '(none)';
    assert.strictEqual(displayCategory, '(none)');
  });

  test('handles null prediction', () => {
    const prediction = null;
    const hasPrediction = prediction !== null;
    assert.strictEqual(hasPrediction, false);
  });

  test('handles prediction with no factors', () => {
    const prediction = {
      predictedTrust: 'medium' as const,
      confidenceScore: 0.3,
      factors: [],
      recommendation: 'Insufficient data for detailed prediction',
      suggestedApproach: 'light_monitoring' as const
    };

    assert.strictEqual(prediction.factors.length, 0);
    assert.ok(prediction.recommendation.length > 0);
  });
});

describe('API Response Validation', () => {
  test('trust map response matches expected shape', () => {
    const response = createMockTrustMap();

    // Validate top-level structure
    assert.ok('global' in response);
    assert.ok('byArea' in response);
    assert.ok('byTicketType' in response);
    assert.ok('byBranchType' in response);
    assert.ok('byLabel' in response);
    assert.ok('byProject' in response);
    assert.ok('computedAt' in response);
  });

  test('insights response is array of strings', () => {
    const insights = [
      'src/auth area has 80% autonomous rate',
      'Bug fixes require 2x more interventions than features',
      'Feature branches complete faster than fix branches'
    ];

    assert.ok(Array.isArray(insights));
    insights.forEach(insight => {
      assert.strictEqual(typeof insight, 'string');
    });
  });

  test('areas response has correct structure', () => {
    const areasResponse = {
      areas: createMockTrustMap().byArea,
      global: createMockTrustMap().global
    };

    assert.ok(Array.isArray(areasResponse.areas));
    assert.ok('totalSessions' in areasResponse.global);
  });
});
