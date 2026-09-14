import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number counting up from 0 to `target` once `start` becomes
 * true (pair with useInView so a stat card counts up when it scrolls into
 * view, not on every render). Respects prefers-reduced-motion by jumping
 * straight to the final value.
 *
 * @param {number} target
 * @param {object} [options]
 * @param {boolean} [options.start=true]
 * @param {number} [options.durationMs=1200]
 * @returns {number} the current animated value, rounded to an integer.
 */
export function useCountUp(target, { start = true, durationMs = 1200 } = {}) {
  const [value, setValue] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!start) return undefined;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setValue(target);
      return undefined;
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, start, durationMs]);

  return value;
}
