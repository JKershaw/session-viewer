/**
 * Unit tests for the frontend store - trust and view state management.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock DOM globals for store to work
globalThis.document = {
  readyState: 'complete',
  addEventListener: () => {},
  createElement: () => ({ style: {} }),
  getElementById: () => null,
  querySelectorAll: () => []
} as unknown as Document;

globalThis.window = {
  location: { origin: 'http://localhost:3000' }
} as unknown as Window & typeof globalThis;

// Dynamic import to ensure mocks are set up first
const importStore = async () => {
  // Clear module cache to get fresh store for each test
  const storeModule = await import('../../../public/js/state/store.js');
  return storeModule;
};

describe('Store - Trust State', () => {
  test('initializes with null trust map', async () => {
    const { store } = await importStore();
    const state = store.getState();

    assert.strictEqual(state.trust.map, null);
    assert.deepStrictEqual(state.trust.insights, []);
    assert.deepStrictEqual(state.trust.areas, []);
    assert.strictEqual(state.trust.prediction, null);
    assert.strictEqual(state.trust.loading, false);
    assert.strictEqual(state.trust.error, null);
  });

  test('setTrustMap updates state correctly', async () => {
    const { store, setTrustMap } = await importStore();

    const mockTrustMap = {
      global: {
        totalSessions: 10,
        autonomousRate: 0.7,
        avgTrustScore: 0.65,
        avgInterventionCount: 1.5
      },
      byArea: [],
      byTicketType: [],
      byBranchType: [],
      byLabel: [],
      byProject: [],
      computedAt: '2026-01-15T10:00:00Z'
    };

    setTrustMap(mockTrustMap);

    const state = store.getState();
    assert.deepStrictEqual(state.trust.map, mockTrustMap);
    assert.strictEqual(state.trust.lastComputed, '2026-01-15T10:00:00Z');
  });

  test('setTrustLoading toggles loading flag', async () => {
    const { store, setTrustLoading } = await importStore();

    setTrustLoading(true);
    assert.strictEqual(store.getState().trust.loading, true);

    setTrustLoading(false);
    assert.strictEqual(store.getState().trust.loading, false);
  });

  test('setTrustError stores error message', async () => {
    const { store, setTrustError } = await importStore();

    setTrustError('Network error');
    assert.strictEqual(store.getState().trust.error, 'Network error');

    setTrustError(null);
    assert.strictEqual(store.getState().trust.error, null);
  });

  test('setTrustInsights updates insights array', async () => {
    const { store, setTrustInsights } = await importStore();

    const insights = [
      'src/auth has 80% autonomous rate',
      'Bug fixes require more steering than features'
    ];

    setTrustInsights(insights);
    assert.deepStrictEqual(store.getState().trust.insights, insights);
  });

  test('setTrustAreas updates areas array', async () => {
    const { store, setTrustAreas } = await importStore();

    const areas = [
      {
        category: 'src/auth',
        categoryType: 'area' as const,
        totalSessions: 5,
        autonomousSessions: 4,
        autonomousRate: 0.8,
        avgTrustScore: 0.75,
        avgInterventionCount: 0.6,
        avgInterventionDensity: 0.5,
        commitRate: 0.9,
        reworkRate: 0.1,
        errorRate: 0.05,
        avgFirstInterventionProgress: 0.7,
        confidence: 0.85,
        updatedAt: '2026-01-15T10:00:00Z'
      }
    ];

    setTrustAreas(areas);
    assert.deepStrictEqual(store.getState().trust.areas, areas);
  });

  test('setTrustPrediction stores prediction result', async () => {
    const { store, setTrustPrediction } = await importStore();

    const prediction = {
      predictedTrust: 'high' as const,
      confidenceScore: 0.85,
      factors: [
        {
          source: 'area:src/auth',
          trustLevel: 0.8,
          weight: 0.9,
          sampleSize: 5,
          insight: 'This area has high autonomy historically'
        }
      ],
      recommendation: 'Claude can likely handle this autonomously',
      suggestedApproach: 'autonomous' as const
    };

    setTrustPrediction(prediction);
    assert.deepStrictEqual(store.getState().trust.prediction, prediction);
  });

  test('notifies subscribers on trust state change', async () => {
    const { store, setTrustMap } = await importStore();

    let notified = false;
    let receivedState = null;
    let receivedPrevState = null;

    store.subscribe((state: unknown, prevState: unknown) => {
      notified = true;
      receivedState = state;
      receivedPrevState = prevState;
    });

    const mockMap = {
      global: { totalSessions: 1, autonomousRate: 1, avgTrustScore: 1, avgInterventionCount: 0 },
      byArea: [],
      byTicketType: [],
      byBranchType: [],
      byLabel: [],
      byProject: [],
      computedAt: '2026-01-15T10:00:00Z'
    };

    setTrustMap(mockMap);

    assert.strictEqual(notified, true);
    assert.ok(receivedState);
    assert.ok(receivedPrevState);
  });
});

describe('Store - View State', () => {
  test('initializes with timeline view', async () => {
    const { store } = await importStore();
    const state = store.getState();

    assert.strictEqual(state.view, 'timeline');
  });

  test('setView changes active view', async () => {
    const { store, setView } = await importStore();

    setView('trust-dashboard');
    assert.strictEqual(store.getState().view, 'trust-dashboard');

    setView('timeline');
    assert.strictEqual(store.getState().view, 'timeline');
  });

  test('notifies subscribers on view change', async () => {
    const { store, setView } = await importStore();

    let viewChanged = false;

    store.subscribe((state: { view: string }, prevState: { view: string }) => {
      if (state.view !== prevState.view) {
        viewChanged = true;
      }
    });

    setView('trust-dashboard');
    assert.strictEqual(viewChanged, true);
  });
});

describe('Store - State Isolation', () => {
  test('trust state updates do not affect other state', async () => {
    const { store, setTrustLoading, setLoading } = await importStore();

    // Set some initial state
    setLoading(true);

    // Update trust state
    setTrustLoading(true);

    // Verify both are independent
    const state = store.getState();
    assert.strictEqual(state.loading, true);
    assert.strictEqual(state.trust.loading, true);

    // Change one without affecting the other
    setLoading(false);
    assert.strictEqual(store.getState().loading, false);
    assert.strictEqual(store.getState().trust.loading, true);
  });

  test('view state is independent of trust state', async () => {
    const { store, setView, setTrustMap } = await importStore();

    setView('trust-dashboard');
    setTrustMap({
      global: { totalSessions: 5, autonomousRate: 0.8, avgTrustScore: 0.7, avgInterventionCount: 1 },
      byArea: [],
      byTicketType: [],
      byBranchType: [],
      byLabel: [],
      byProject: [],
      computedAt: '2026-01-15T10:00:00Z'
    });

    const state = store.getState();
    assert.strictEqual(state.view, 'trust-dashboard');
    assert.strictEqual(state.trust.map?.global.totalSessions, 5);
  });
});
