/**
 * DOM utility functions.
 */

/**
 * Create an element with attributes and children.
 */
export const createElement = (tag, attrs = {}, children = []) => {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      return; // Skip null/undefined attributes
    } else if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        el.dataset[dataKey] = dataValue;
      });
    } else {
      el.setAttribute(key, value);
    }
  });

  const childArray = Array.isArray(children) ? children : [children];
  childArray.forEach(child => {
    if (child === null || child === undefined) return;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  });

  return el;
};

/**
 * Shorthand for creating elements.
 */
export const div = (attrs, children) => createElement('div', attrs, children);
export const span = (attrs, children) => createElement('span', attrs, children);
export const button = (attrs, children) => createElement('button', attrs, children);
export const input = (attrs) => createElement('input', attrs);
export const select = (attrs, children) => createElement('select', attrs, children);
export const option = (attrs, children) => createElement('option', attrs, children);
export const label = (attrs, children) => createElement('label', attrs, children);
export const h1 = (attrs, children) => createElement('h1', attrs, children);
export const h2 = (attrs, children) => createElement('h2', attrs, children);
export const h3 = (attrs, children) => createElement('h3', attrs, children);

/**
 * Clear all children from an element.
 */
export const clearChildren = (el) => {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
};

/**
 * Get element by ID.
 */
export const $ = (id) => document.getElementById(id);

/**
 * Query selector.
 */
export const $$ = (selector) => document.querySelectorAll(selector);
