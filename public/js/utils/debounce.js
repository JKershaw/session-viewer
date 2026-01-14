/**
 * Debounce and throttle utilities.
 */

/**
 * Debounce a function - delay execution until after wait ms have elapsed
 * since the last call.
 */
export const debounce = (fn, wait = 100) => {
  let timeoutId = null;

  const debounced = (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, wait);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
};

/**
 * Throttle a function - limit execution to at most once per wait ms.
 */
export const throttle = (fn, wait = 100) => {
  let lastTime = 0;
  let timeoutId = null;

  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - lastTime);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastTime = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
};
