import { useEffect, useRef, useState } from 'react';

/**
 * Reveals an element once it scrolls into the viewport, so landing/dashboard
 * sections can fade/slide in as the user scrolls rather than all rendering
 * at once. Fires once (`triggerOnce`) — a stat card shouldn't re-animate
 * every time it's scrolled past. Falls back to "already visible" if
 * IntersectionObserver isn't available, so nothing depends on it to render.
 *
 * @param {object} [options]
 * @param {number} [options.threshold=0.15]
 * @param {boolean} [options.triggerOnce=true]
 * @returns {[React.RefObject, boolean]} `[ref, isVisible]` — attach `ref` to the element.
 */
export function useInView({ threshold = 0.15, triggerOnce = true } = {}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) observer.disconnect();
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, triggerOnce]);

  return [ref, isVisible];
}
