import { useState, useEffect } from 'react';

/**
 * Uses the Visual Viewport API to detect the software keyboard height offset.
 * Returns the number of pixels the viewport is reduced (i.e., keyboard height).
 */
export function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }

    const update = () => {
      const keyboardHeight = window.innerHeight - vv.height;
      setOffset(Math.max(0, keyboardHeight));
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return offset;
}
