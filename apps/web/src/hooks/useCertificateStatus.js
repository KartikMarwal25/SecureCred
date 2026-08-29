import { useCallback, useEffect, useRef, useState } from 'react';
import { CERT_STATE } from '@securecred/shared';
import { getCertificateStatus, ApiError } from '../api/client.js';

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 3 * 60 * 1000;

const TERMINAL_STATES = new Set([CERT_STATE.ACTIVE, CERT_STATE.REVOKED, CERT_STATE.FAILED]);

/**
 * Polls GET /certificates/:id/status every ~5s for up to 3 minutes while the
 * certificate is in a non-terminal state, then stops and leaves it to the
 * caller to offer a manual "Refresh" (via the returned `refresh`).
 *
 * `enabled` lets the caller skip polling entirely once it already knows the
 * certificate is terminal (e.g. straight from GET /certificates/:id).
 */
export function useCertificateStatus(id, { enabled = true } = {}) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(enabled);
  const [timedOut, setTimedOut] = useState(false);
  const startRef = useRef(Date.now());

  const fetchOnce = useCallback(async () => {
    if (!id) return null;
    try {
      const data = await getCertificateStatus(id);
      setStatus(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Could not check the status right now.'));
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (!id || !enabled) {
      setIsPolling(false);
      return undefined;
    }

    startRef.current = Date.now();
    setIsPolling(true);
    setTimedOut(false);
    let cancelled = false;
    let timerId;

    const tick = async () => {
      if (cancelled) return;
      const data = await fetchOnce();
      if (cancelled) return;
      if (data && TERMINAL_STATES.has(data.state)) {
        setIsPolling(false);
        return;
      }
      if (Date.now() - startRef.current >= MAX_POLL_MS) {
        setIsPolling(false);
        setTimedOut(true);
        return;
      }
      timerId = setTimeout(tick, POLL_INTERVAL_MS);
    };

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [id, enabled, fetchOnce]);

  const refresh = useCallback(async () => {
    setTimedOut(false);
    startRef.current = Date.now();
    return fetchOnce();
  }, [fetchOnce]);

  return { status, error, isPolling, timedOut, refresh };
}
