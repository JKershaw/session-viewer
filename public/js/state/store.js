/**
 * Simple state management store with pub/sub pattern.
 */

const createStore = (initialState) => {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    getState: () => state,

    setState: (update) => {
      const prevState = state;
      state = typeof update === 'function'
        ? { ...state, ...update(state) }
        : { ...state, ...update };

      // Notify listeners
      listeners.forEach(fn => fn(state, prevState));
    },

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
};

// Application state
export const store = createStore({
  // Sessions data
  sessions: [],
  selectedSession: null,
  selectedSessionDetails: null,

  // Filters
  filters: {
    dateFrom: null,
    dateTo: null,
    folder: '',
    branch: '',
    ticket: ''
  },

  // Available filter options (populated from data)
  filterOptions: {
    folders: [],
    branches: [],
    tickets: []
  },

  // Timeline state
  timeline: {
    viewStart: Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
    viewEnd: Date.now(),
    zoomLevel: 0 // 0 = fit all, 100 = max zoom
  },

  // Visible time range (for footer display)
  visibleTimeRange: {
    start: null,
    end: null
  },

  // UI state
  loading: false,
  error: null,
  success: null,
  detailPanelOpen: false,

  // View state for navigation
  view: 'timeline', // 'timeline' | 'trust-dashboard'

  // Trust analysis state
  trust: {
    map: null,           // TrustMap object from API
    insights: [],        // Array of insight strings
    areas: [],           // Trust by area data
    prediction: null,    // Current prediction result
    loading: false,
    error: null,
    lastComputed: null
  },

  // Dispatch state
  dispatch: {
    available: [],       // Available prompts from dispatch queue
    claimed: [],         // Locally claimed prompts
    loading: false,
    error: null,
    configured: false,   // Whether dispatch is configured
    // Auto-claim settings
    settings: {
      enabled: false,
      pollingIntervalMs: 3000,
      maxClaimsPerPoll: 1,
      lastPollAt: null,
      lastClaimAt: null,
      lastError: null,
      totalClaimedCount: 0,
      pollerRunning: false
    }
  }
});

// Convenience methods for common state updates
export const setLoading = (loading) => store.setState({ loading });
export const setError = (error) => store.setState({ error });
export const setSuccess = (success) => store.setState({ success });
export const setSessions = (sessions) => store.setState({ sessions });
export const setSelectedSession = (session) => store.setState({
  selectedSession: session,
  detailPanelOpen: !!session
});
export const setFilters = (filters) => store.setState(state => ({
  filters: { ...state.filters, ...filters }
}));
export const setTimeline = (timeline) => store.setState(state => ({
  timeline: { ...state.timeline, ...timeline }
}));
export const setFilterOptions = (options) => store.setState(state => ({
  filterOptions: { ...state.filterOptions, ...options }
}));
export const setVisibleTimeRange = (start, end) => store.setState({
  visibleTimeRange: { start, end }
});

// View navigation
export const setView = (view) => store.setState({ view });

// Trust state convenience methods
export const setTrustMap = (map) => store.setState(state => ({
  trust: { ...state.trust, map, lastComputed: map?.computedAt || null }
}));

export const setTrustInsights = (insights) => store.setState(state => ({
  trust: { ...state.trust, insights }
}));

export const setTrustAreas = (areas) => store.setState(state => ({
  trust: { ...state.trust, areas }
}));

export const setTrustPrediction = (prediction) => store.setState(state => ({
  trust: { ...state.trust, prediction }
}));

export const setTrustLoading = (loading) => store.setState(state => ({
  trust: { ...state.trust, loading }
}));

export const setTrustError = (error) => store.setState(state => ({
  trust: { ...state.trust, error }
}));

// Dispatch state convenience methods
export const setDispatchAvailable = (available) => store.setState(state => ({
  dispatch: { ...state.dispatch, available }
}));

export const setDispatchClaimed = (claimed) => store.setState(state => ({
  dispatch: { ...state.dispatch, claimed }
}));

export const addDispatchClaimed = (prompt) => store.setState(state => ({
  dispatch: { ...state.dispatch, claimed: [...state.dispatch.claimed, prompt] }
}));

export const removeDispatchClaimed = (id) => store.setState(state => ({
  dispatch: {
    ...state.dispatch,
    claimed: state.dispatch.claimed.filter(p => p.id !== id)
  }
}));

export const setDispatchLoading = (loading) => store.setState(state => ({
  dispatch: { ...state.dispatch, loading }
}));

export const setDispatchError = (error) => store.setState(state => ({
  dispatch: { ...state.dispatch, error }
}));

export const setDispatchConfigured = (configured) => store.setState(state => ({
  dispatch: { ...state.dispatch, configured }
}));

export const setDispatchSettings = (settings) => store.setState(state => ({
  dispatch: { ...state.dispatch, settings: { ...state.dispatch.settings, ...settings } }
}));
