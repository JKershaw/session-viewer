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
  detailPanelOpen: false
});

// Convenience methods for common state updates
export const setLoading = (loading) => store.setState({ loading });
export const setError = (error) => store.setState({ error });
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
