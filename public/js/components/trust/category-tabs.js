/**
 * Category Tabs Component - Tabbed tables showing trust aggregates by category.
 */
import { store } from '../../state/store.js';
import { div, button, span, h3 } from '../../utils/dom.js';

const CATEGORIES = [
  { id: 'byArea', label: 'Area', key: 'byArea' },
  { id: 'byTicketType', label: 'Ticket Type', key: 'byTicketType' },
  { id: 'byBranchType', label: 'Branch Type', key: 'byBranchType' },
  { id: 'byLabel', label: 'Label', key: 'byLabel' },
  { id: 'byProject', label: 'Project', key: 'byProject' }
];

const getTrustColorClass = (score) => {
  if (score >= 0.7) return 'trust-high';
  if (score >= 0.4) return 'trust-medium';
  return 'trust-low';
};

const createMiniBar = (value, colorClass) => {
  return div({ className: 'mini-bar' }, [
    div({ className: 'mini-bar-track' }, [
      div({
        className: `mini-bar-fill ${colorClass}`,
        style: `width: ${Math.min(100, Math.max(0, value))}%`
      })
    ]),
    span({ className: 'mini-bar-value' }, `${Math.round(value)}%`)
  ]);
};

const createTableHeader = (columns, sortColumn, sortDirection, onSort) => {
  const cells = columns.map(col =>
    div(
      {
        className: `table-header-cell ${sortColumn === col.key ? 'sorted' : ''}`,
        onClick: () => onSort(col.key),
        role: 'columnheader',
        'aria-sort': sortColumn === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
      },
      [
        span({}, col.label),
        sortColumn === col.key
          ? span({ className: 'sort-indicator' }, sortDirection === 'asc' ? '↑' : '↓')
          : null
      ].filter(Boolean)
    )
  );

  return div({ className: 'table-header', role: 'row' }, cells);
};

const createTableRow = (aggregate) => {
  const autonomousPercent = aggregate.autonomousRate * 100;
  const trustPercent = aggregate.avgTrustScore * 100;
  const commitPercent = aggregate.commitRate * 100;
  const reworkPercent = aggregate.reworkRate * 100;
  const confidencePercent = aggregate.confidence * 100;

  return div({ className: 'table-row', role: 'row' }, [
    div({ className: 'table-cell category-name', role: 'cell' }, aggregate.category || '(none)'),
    div({ className: 'table-cell', role: 'cell' }, aggregate.totalSessions.toString()),
    div({ className: 'table-cell', role: 'cell' }, createMiniBar(autonomousPercent, getTrustColorClass(aggregate.autonomousRate))),
    div({ className: 'table-cell', role: 'cell' }, createMiniBar(trustPercent, getTrustColorClass(aggregate.avgTrustScore))),
    div({ className: 'table-cell', role: 'cell' }, `${Math.round(commitPercent)}%`),
    div({ className: 'table-cell', role: 'cell' }, `${Math.round(reworkPercent)}%`),
    div({ className: 'table-cell', role: 'cell' }, createMiniBar(confidencePercent, confidencePercent >= 70 ? 'trust-high' : confidencePercent >= 40 ? 'trust-medium' : 'trust-low'))
  ]);
};

export const initCategoryTabs = (container) => {
  let activeTab = 'byArea';
  let sortColumn = 'totalSessions';
  let sortDirection = 'desc';

  const columns = [
    { key: 'category', label: 'Category' },
    { key: 'totalSessions', label: 'Sessions' },
    { key: 'autonomousRate', label: 'Autonomous %' },
    { key: 'avgTrustScore', label: 'Trust Score' },
    { key: 'commitRate', label: 'Commit %' },
    { key: 'reworkRate', label: 'Rework %' },
    { key: 'confidence', label: 'Confidence' }
  ];

  const handleTabClick = (tabId) => {
    activeTab = tabId;
    render();
  };

  const handleSort = (columnKey) => {
    if (sortColumn === columnKey) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = columnKey;
      sortDirection = 'desc';
    }
    render();
  };

  const render = () => {
    const state = store.getState();
    const { trust } = state;

    // Title
    const title = h3({ className: 'category-tabs-title' }, 'Trust Breakdown by Category');

    // Tab buttons
    const tabButtons = CATEGORIES.map(cat =>
      button(
        {
          className: `category-tab-btn ${activeTab === cat.id ? 'active' : ''}`,
          onClick: () => handleTabClick(cat.id),
          role: 'tab',
          'aria-selected': activeTab === cat.id ? 'true' : 'false'
        },
        cat.label
      )
    );

    const tabButtonsContainer = div(
      { className: 'category-tab-buttons', role: 'tablist' },
      tabButtons
    );

    // Get data for active tab
    const data = trust.map?.[activeTab] || [];

    if (data.length === 0) {
      container.innerHTML = '';
      container.appendChild(title);
      container.appendChild(tabButtonsContainer);
      container.appendChild(
        div({ className: 'category-tabs-empty' }, 'No data available for this category')
      );
      return;
    }

    // Sort data
    const sortedData = [...data].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Create table
    const tableHeader = createTableHeader(columns, sortColumn, sortDirection, handleSort);
    const tableRows = sortedData.map(row => createTableRow(row));
    const tableBody = div({ className: 'table-body', role: 'rowgroup' }, tableRows);
    const table = div({ className: 'trust-table', role: 'table' }, [tableHeader, tableBody]);

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(tabButtonsContainer);
    container.appendChild(table);
  };

  // Subscribe to trust map changes
  store.subscribe((state, prevState) => {
    if (state.trust.map !== prevState.trust.map) {
      render();
    }
  });

  // Initial render
  render();
};
