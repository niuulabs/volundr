import { useState, useEffect } from 'react';

/**
 * Detects whether the current device has touch capability and a narrow viewport.
 * Returns true on touch devices with viewport width <= maxWidth.
 */
export function useIsTouchDevice(maxWidth = 1024): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const check = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isNarrow = window.innerWidth <= maxWidth;
      setIsTouch(hasTouch && isNarrow);
    };

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [maxWidth]);

  return isTouch;
}
