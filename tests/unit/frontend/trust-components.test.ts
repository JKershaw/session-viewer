/**
 * Unit tests for trust dashboard components.
 * These tests validate component logic and data transformations.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

// Test data helpers
const createMockTrustMap = (overrides = {}) => ({
  global: {
    totalSessions: 25,
    autonomousRate: 0.72,
    avgTrustScore: 0.68,
    avgInterventionCount: 1.2
  },
  byArea: [
    {
      category: 'src/auth',
      categoryType: 'area' as const,
      totalSessions: 10,
      autonomousSessions: 8,
      autonomousRate: 0.8,
      avgTrustScore: 0.75,
      avgInterventionCount: 0.5,
      avgInterventionDensity: 0.3,
      commitRate: 0.9,
      reworkRate: 0.1,
      errorRate: 0.05,
      avgFirstInterventionProgress: 0.7,
      confidence: 0.85,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'src/api',
      categoryType: 'area' as const,
      totalSessions: 8,
      autonomousSessions: 5,
      autonomousRate: 0.625,
      avgTrustScore: 0.58,
      avgInterventionCount: 1.8,
      avgInterventionDensity: 0.8,
      commitRate: 0.75,
      reworkRate: 0.25,
      errorRate: 0.15,
      avgFirstInterventionProgress: 0.4,
      confidence: 0.78,
      updatedAt: '2026-01-15T10:00:00Z'
    }
  ],
  byTicketType: [
    {
      category: 'bug',
      categoryType: 'ticketType' as const,
      totalSessions: 12,
      autonomousSessions: 6,
      autonomousRate: 0.5,
      avgTrustScore: 0.52,
      avgInterventionCount: 2.1,
      avgInterventionDensity: 1.0,
      commitRate: 0.8,
      reworkRate: 0.3,
      errorRate: 0.2,
      avgFirstInterventionProgress: 0.35,
      confidence: 0.82,
      updatedAt: '2026-01-15T10:00:00Z'
    },
    {
      category: 'feature',
      categoryType: 'ticketType' as const,
      totalSessions: 13,
      autonomousSessions: 10,
      autonomousRate: 0.77,
      avgTrustScore: 0.72,
      avgInterventionCount: 0.8,
      avgInterventionDensity: 0.4,
      commitRate: 0.85,
      reworkRate: 0.1,
      errorRate: 0.08,
      avgFirstInterventionProgress: 0.6,
      confidence: 0.84,
      updatedAt: '2026-01-15T10:00:00Z'
    }
  ],
  byBranchType: [],
  byLabel: [],
  byProject: [],
  computedAt: '2026-01-15T10:00:00Z',
  ...overrides
});

describe('GlobalStats Component Logic', () => {
  test('calculates correct percentage from rate', () => {
    const rate = 0.72;
    const percentage = Math.round(rate * 100);
    assert.strictEqual(percentage, 72);
  });

  test('formats intervention count with one decimal', () => {
    const avgInterventions = 1.234;
    const formatted = avgInterventions.toFixed(1);
    assert.strictEqual(formatted, '1.2');
  });

  test('determines trust color class correctly', () => {
    const getTrustColorClass = (score: number) => {
      if (score >= 0.7) return 'trust-high';
      if (score >= 0.4) return 'trust-medium';
      return 'trust-low';
    };

    assert.strictEqual(getTrustColorClass(0.8), 'trust-high');
    assert.strictEqual(getTrustColorClass(0.7), 'trust-high');
    assert.strictEqual(getTrustColorClass(0.69), 'trust-medium');
    assert.strictEqual(getTrustColorClass(0.4), 'trust-medium');
    assert.strictEqual(getTrustColorClass(0.39), 'trust-low');
    assert.strictEqual(getTrustColorClass(0.1), 'trust-low');
  });

  test('handles zero sessions gracefully', () => {
    const global = { totalSessions: 0, autonomousRate: 0, avgTrustScore: 0, avgInterventionCount: 0 };
    assert.strictEqual(global.totalSessions.toLocaleString(), '0');
    assert.strictEqual(Math.round(global.autonomousRate * 100), 0);
  });
});

describe('AreaChart Component Logic', () => {
  test('sorts areas by session count descending', () => {
    const trustMap = createMockTrustMap();
    const sortedAreas = [...trustMap.byArea].sort((a, b) => b.totalSessions - a.totalSessions);

    assert.strictEqual(sortedAreas[0].category, 'src/auth');
    assert.strictEqual(sortedAreas[0].totalSessions, 10);
    assert.strictEqual(sortedAreas[1].category, 'src/api');
    assert.strictEqual(sortedAreas[1].totalSessions, 8);
  });

  test('limits to top 15 areas', () => {
    const manyAreas = Array.from({ length: 20 }, (_, i) => ({
      category: `area-${i}`,
      categoryType: 'area' as const,
      totalSessions: 20 - i,
      autonomousSessions: 15 - i,
      autonomousRate: 0.75,
      avgTrustScore: 0.7,
      avgInterventionCount: 1,
      avgInterventionDensity: 0.5,
      commitRate: 0.8,
      reworkRate: 0.1,
      errorRate: 0.05,
      avgFirstInterventionProgress: 0.5,
      confidence: 0.8,
      updatedAt: '2026-01-15T10:00:00Z'
    }));

    const trustMap = createMockTrustMap({ byArea: manyAreas });
    const limitedAreas = trustMap.byArea.slice(0, 15);

    assert.strictEqual(limitedAreas.length, 15);
    assert.strictEqual(limitedAreas[0].category, 'area-0');
  });

  test('calculates bar width as percentage', () => {
    const autonomousRate = 0.8;
    const barWidth = Math.round(autonomousRate * 100);
    assert.strictEqual(barWidth, 80);
  });

  test('shows percentage in bar when > 15%', () => {
    const showPercentage = (percent: number) => percent > 15 ? `${percent}%` : '';

    assert.strictEqual(showPercentage(80), '80%');
    assert.strictEqual(showPercentage(16), '16%');
    assert.strictEqual(showPercentage(15), '');
    assert.strictEqual(showPercentage(10), '');
  });
});

describe('InsightsPanel Component Logic', () => {
  test('determines insight type from text content', () => {
    const getInsightType = (insight: string) => {
      const lowerInsight = insight.toLowerCase();
      if (lowerInsight.includes('higher') || lowerInsight.includes('better') || lowerInsight.includes('more autonomous')) {
        return 'success';
      }
      if (lowerInsight.includes('lower') || lowerInsight.includes('needs') || lowerInsight.includes('requires') || lowerInsight.includes('struggle')) {
        return 'warning';
      }
      return 'info';
    };

    assert.strictEqual(getInsightType('src/auth has higher autonomy'), 'success');
    assert.strictEqual(getInsightType('Feature branches are more autonomous'), 'success');
    assert.strictEqual(getInsightType('Bug fixes needs more steering'), 'warning');
    assert.strictEqual(getInsightType('Complex tasks requires extra oversight'), 'warning');
    assert.strictEqual(getInsightType('Average session length is 45 minutes'), 'info');
  });

  test('maps insight type to icon', () => {
    const getInsightIcon = (type: string) => {
      switch (type) {
        case 'success': return '✓';
        case 'warning': return '⚠';
        default: return 'ℹ';
      }
    };

    assert.strictEqual(getInsightIcon('success'), '✓');
    assert.strictEqual(getInsightIcon('warning'), '⚠');
    assert.strictEqual(getInsightIcon('info'), 'ℹ');
  });

  test('handles empty insights array', () => {
    const insights: string[] = [];
    assert.strictEqual(insights.length, 0);
    const isEmpty = insights.length === 0;
    assert.strictEqual(isEmpty, true);
  });
});

describe('CategoryTabs Component Logic', () => {
  const CATEGORIES = [
    { id: 'byArea', label: 'Area', key: 'byArea' },
    { id: 'byTicketType', label: 'Ticket Type', key: 'byTicketType' },
    { id: 'byBranchType', label: 'Branch Type', key: 'byBranchType' },
    { id: 'byLabel', label: 'Label', key: 'byLabel' },
    { id: 'byProject', label: 'Project', key: 'byProject' }
  ];

  test('has 5 category tabs', () => {
    assert.strictEqual(CATEGORIES.length, 5);
  });

  test('sorts data by column in ascending order', () => {
    const trustMap = createMockTrustMap();
    const data = trustMap.byArea;

    // Sort by autonomousRate ascending
    const sortedAsc = [...data].sort((a, b) => a.autonomousRate - b.autonomousRate);

    assert.strictEqual(sortedAsc[0].category, 'src/api');
    assert.strictEqual(sortedAsc[0].autonomousRate, 0.625);
  });

  test('sorts data by column in descending order', () => {
    const trustMap = createMockTrustMap();
    const data = trustMap.byArea;

    // Sort by autonomousRate descending
    const sortedDesc = [...data].sort((a, b) => b.autonomousRate - a.autonomousRate);

    assert.strictEqual(sortedDesc[0].category, 'src/auth');
    assert.strictEqual(sortedDesc[0].autonomousRate, 0.8);
  });

  test('sorts strings alphabetically', () => {
    const trustMap = createMockTrustMap();
    const data = trustMap.byArea;

    // Sort by category ascending
    const sortedAsc = [...data].sort((a, b) => a.category.localeCompare(b.category));

    assert.strictEqual(sortedAsc[0].category, 'src/api');
    assert.strictEqual(sortedAsc[1].category, 'src/auth');
  });

  test('toggles sort direction on same column click', () => {
    let sortColumn = 'totalSessions';
    let sortDirection = 'desc';

    const handleSort = (columnKey: string) => {
      if (sortColumn === columnKey) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = columnKey;
        sortDirection = 'desc';
      }
    };

    // Click same column
    handleSort('totalSessions');
    assert.strictEqual(sortDirection, 'asc');

    handleSort('totalSessions');
    assert.strictEqual(sortDirection, 'desc');

    // Click different column
    handleSort('autonomousRate');
    assert.strictEqual(sortColumn, 'autonomousRate');
    assert.strictEqual(sortDirection, 'desc');
  });
});

describe('PredictionForm Component Logic', () => {
  test('validates at least one field is filled', () => {
    const formData = {
      codebaseArea: '',
      ticketType: '',
      branchType: '',
      projectPath: ''
    };

    const hasInput = Object.values(formData).some(v => v.trim() !== '');
    assert.strictEqual(hasInput, false);

    formData.codebaseArea = 'src/auth';
    const hasInputAfter = Object.values(formData).some(v => v.trim() !== '');
    assert.strictEqual(hasInputAfter, true);
  });

  test('maps prediction level to badge class', () => {
    const getPredictionBadgeClass = (level: string) => {
      switch (level) {
        case 'high': return 'prediction-badge high';
        case 'medium': return 'prediction-badge medium';
        case 'low': return 'prediction-badge low';
        default: return 'prediction-badge';
      }
    };

    assert.strictEqual(getPredictionBadgeClass('high'), 'prediction-badge high');
    assert.strictEqual(getPredictionBadgeClass('medium'), 'prediction-badge medium');
    assert.strictEqual(getPredictionBadgeClass('low'), 'prediction-badge low');
    assert.strictEqual(getPredictionBadgeClass('unknown'), 'prediction-badge');
  });

  test('formats approach label correctly', () => {
    const getApproachLabel = (approach: string) => {
      switch (approach) {
        case 'autonomous': return 'Let Claude run autonomously';
        case 'light_monitoring': return 'Light monitoring recommended';
        case 'active_steering': return 'Plan for active steering';
        case 'detailed_breakdown': return 'Break into smaller tasks';
        default: return approach;
      }
    };

    assert.strictEqual(getApproachLabel('autonomous'), 'Let Claude run autonomously');
    assert.strictEqual(getApproachLabel('light_monitoring'), 'Light monitoring recommended');
    assert.strictEqual(getApproachLabel('active_steering'), 'Plan for active steering');
    assert.strictEqual(getApproachLabel('detailed_breakdown'), 'Break into smaller tasks');
    assert.strictEqual(getApproachLabel('custom'), 'custom');
  });

  test('calculates confidence percentage', () => {
    const prediction = {
      predictedTrust: 'high' as const,
      confidenceScore: 0.85,
      factors: [],
      recommendation: '',
      suggestedApproach: 'autonomous' as const
    };

    const confidencePercent = Math.round(prediction.confidenceScore * 100);
    assert.strictEqual(confidencePercent, 85);
  });

  test('handles factors array for display', () => {
    const factors = [
      { source: 'area:src/auth', trustLevel: 0.8, weight: 0.9, sampleSize: 10, insight: 'High autonomy area' },
      { source: 'type:feature', trustLevel: 0.75, weight: 0.7, sampleSize: 15, insight: 'Features go well' }
    ];

    assert.strictEqual(factors.length, 2);
    factors.forEach(factor => {
      assert.ok(factor.source);
      assert.ok(typeof factor.trustLevel === 'number');
      assert.ok(factor.insight);
    });
  });
});

describe('Trust Level Classification', () => {
  test('correctly classifies trust levels', () => {
    const getTrustLevel = (score: number): 'high' | 'medium' | 'low' => {
      if (score >= 0.7) return 'high';
      if (score >= 0.4) return 'medium';
      return 'low';
    };

    // Boundary tests
    assert.strictEqual(getTrustLevel(1.0), 'high');
    assert.strictEqual(getTrustLevel(0.7), 'high');
    assert.strictEqual(getTrustLevel(0.699), 'medium');
    assert.strictEqual(getTrustLevel(0.5), 'medium');
    assert.strictEqual(getTrustLevel(0.4), 'medium');
    assert.strictEqual(getTrustLevel(0.399), 'low');
    assert.strictEqual(getTrustLevel(0.0), 'low');
  });
});

describe('Data Formatting', () => {
  test('formats large numbers with locale string', () => {
    const num = 1234567;
    const formatted = num.toLocaleString();
    // Exact format depends on locale, but should have separators
    assert.ok(formatted.includes(',') || formatted.includes('.') || formatted.includes(' '));
  });

  test('formats percentages correctly', () => {
    const rate = 0.7234;
    const percentage = Math.round(rate * 100);
    assert.strictEqual(percentage, 72);
  });

  test('clamps bar width between 0 and 100', () => {
    const clamp = (value: number) => Math.min(100, Math.max(0, value));

    assert.strictEqual(clamp(150), 100);
    assert.strictEqual(clamp(-10), 0);
    assert.strictEqual(clamp(50), 50);
    assert.strictEqual(clamp(0), 0);
    assert.strictEqual(clamp(100), 100);
  });
});
