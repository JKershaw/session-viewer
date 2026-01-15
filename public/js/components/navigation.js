/**
 * Navigation component for switching between views.
 */
import { store, setView } from '../state/store.js';
import { div, button } from '../utils/dom.js';

export const initNavigation = (container) => {
  const render = () => {
    const state = store.getState();
    const currentView = state.view;

    const tabs = [
      { id: 'timeline', label: 'Sessions Timeline' },
      { id: 'trust-dashboard', label: 'Trust Dashboard' }
    ];

    const tabButtons = tabs.map(tab =>
      button(
        {
          className: `nav-tab ${currentView === tab.id ? 'active' : ''}`,
          onClick: () => setView(tab.id),
          'aria-selected': currentView === tab.id ? 'true' : 'false',
          role: 'tab'
        },
        tab.label
      )
    );

    const nav = div(
      {
        className: 'nav-tabs',
        role: 'tablist',
        'aria-label': 'Main navigation'
      },
      tabButtons
    );

    container.innerHTML = '';
    container.appendChild(nav);
  };

  // Subscribe to view changes
  store.subscribe((state, prevState) => {
    if (state.view !== prevState.view) {
      render();
    }
  });

  // Initial render
  render();
};
