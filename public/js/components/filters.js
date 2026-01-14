/**
 * Filters component for filtering sessions.
 */
import { store, setFilters, setSessions, setLoading, setTimeline } from '../state/store.js';
import { api } from '../api/client.js';
import { div, input, select, option, label, button, span, clearChildren } from '../utils/dom.js';
import { formatDateInput } from '../utils/formatters.js';
import { debounce } from '../utils/debounce.js';

export const initFilters = (container) => {
  // Debounced filter application
  const applyFilters = debounce(async () => {
    const state = store.getState();
    const { filters } = state;

    try {
      setLoading(true);
      const result = await api.getSessions({
        ...filters,
        limit: 10000,
        includeEvents: true
      });
      const sortedSessions = result.data.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : NaN;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : NaN;
        const validA = !isNaN(timeA);
        const validB = !isNaN(timeB);
        if (!validA && !validB) return 0;
        if (!validA) return 1;
        if (!validB) return -1;
        return timeB - timeA;
      });
      setSessions(sortedSessions);
    } catch (err) {
      console.error('Filter failed:', err);
    } finally {
      setLoading(false);
    }
  }, 300);

  const handleFilterChange = (field, value) => {
    setFilters({ [field]: value || null });
    applyFilters();
  };

  const handleClearFilters = () => {
    setFilters({
      dateFrom: null,
      dateTo: null,
      folder: '',
      branch: '',
      ticket: ''
    });
    applyFilters();
  };

  const render = () => {
    const state = store.getState();
    const { filters, filterOptions } = state;

    clearChildren(container);

    // Date From
    const dateFromGroup = div({ className: 'filter-group' }, [
      label({}, 'From'),
      input({
        type: 'date',
        value: formatDateInput(filters.dateFrom),
        onInput: (e) => handleFilterChange('dateFrom', e.target.value)
      })
    ]);

    // Date To
    const dateToGroup = div({ className: 'filter-group' }, [
      label({}, 'To'),
      input({
        type: 'date',
        value: formatDateInput(filters.dateTo),
        onInput: (e) => handleFilterChange('dateTo', e.target.value)
      })
    ]);

    // Folder
    const folderSelect = select({
      value: filters.folder,
      onChange: (e) => handleFilterChange('folder', e.target.value)
    }, [
      option({ value: '' }, 'All Folders'),
      ...filterOptions.folders.map(f => option({ value: f }, f))
    ]);
    const folderGroup = div({ className: 'filter-group' }, [
      label({}, 'Folder'),
      folderSelect
    ]);

    // Branch
    const branchSelect = select({
      value: filters.branch,
      onChange: (e) => handleFilterChange('branch', e.target.value)
    }, [
      option({ value: '' }, 'All Branches'),
      ...filterOptions.branches.map(b => option({ value: b }, b))
    ]);
    const branchGroup = div({ className: 'filter-group' }, [
      label({}, 'Branch'),
      branchSelect
    ]);

    // Ticket
    const ticketSelect = select({
      value: filters.ticket,
      onChange: (e) => handleFilterChange('ticket', e.target.value)
    }, [
      option({ value: '' }, 'All Tickets'),
      ...filterOptions.tickets.map(t => option({ value: t.ticketId }, t.ticketId))
    ]);
    const ticketGroup = div({ className: 'filter-group' }, [
      label({}, 'Ticket'),
      ticketSelect
    ]);

    // Zoom slider
    const { timeline } = state;
    const zoomSlider = input({
      type: 'range',
      min: '0',
      max: '100',
      value: String(timeline.zoomLevel),
      className: 'zoom-slider',
      onInput: (e) => setTimeline({ zoomLevel: parseInt(e.target.value, 10) })
    });
    const zoomGroup = div({ className: 'filter-group zoom-group' }, [
      label({}, 'Zoom'),
      div({ className: 'zoom-control' }, [
        span({ className: 'zoom-label' }, 'Fit'),
        zoomSlider,
        span({ className: 'zoom-label' }, 'Detail')
      ])
    ]);

    // Clear button
    const clearBtn = button({
      className: 'btn filter-clear',
      onClick: handleClearFilters
    }, 'Clear Filters');

    container.appendChild(dateFromGroup);
    container.appendChild(dateToGroup);
    container.appendChild(folderGroup);
    container.appendChild(branchGroup);
    container.appendChild(ticketGroup);
    container.appendChild(zoomGroup);
    container.appendChild(clearBtn);
  };

  // Re-render when filter options or timeline zoom changes
  store.subscribe((state, prevState) => {
    if (state.filterOptions !== prevState.filterOptions ||
        state.timeline.zoomLevel !== prevState.timeline.zoomLevel) {
      render();
    }
  });

  // Initial render
  render();
};

/**
 * Extract unique filter options from sessions.
 */
export const extractFilterOptions = (sessions) => {
  const folders = [...new Set(sessions.map(s => s.folder).filter(Boolean))].sort();
  const branches = [...new Set(sessions.map(s => s.branch).filter(Boolean))].sort();

  return { folders, branches };
};
