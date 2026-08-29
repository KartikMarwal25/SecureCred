import { useEffect, useState } from 'react';
import { CERT_STATE } from '@securecred/shared';
import { listCertificates } from '../api/client.js';

const AWAITING_STATES = [CERT_STATE.PENDING_STORAGE, CERT_STATE.PENDING_ANCHOR, CERT_STATE.ANCHORING];
const SUMMARY_SAMPLE_LIMIT = 200;

/**
 * The documented `GET /certificates` contract returns `{items, nextCursor}`
 * with no total count and no dedicated stats endpoint, so this derives the
 * registry summary line by sampling up to SUMMARY_SAMPLE_LIMIT rows per
 * bucket. `isLowerBound` is set when a bucket's sample was cut off by the
 * limit, so the page can render "200+" rather than a false exact total.
 */
export function useRegistrySummary() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function countBucket(status) {
      const data = await listCertificates({ status, limit: SUMMARY_SAMPLE_LIMIT });
      return { count: data.items.length, isLowerBound: Boolean(data.nextCursor) };
    }

    async function load() {
      try {
        const [total, revoked, ...awaiting] = await Promise.all([
          listCertificates({ limit: SUMMARY_SAMPLE_LIMIT }).then((data) => ({
            count: data.items.length,
            isLowerBound: Boolean(data.nextCursor),
          })),
          countBucket(CERT_STATE.REVOKED),
          ...AWAITING_STATES.map(countBucket),
        ]);
        if (cancelled) return;
        setSummary({
          total,
          revoked,
          awaitingAnchor: {
            count: awaiting.reduce((sum, bucket) => sum + bucket.count, 0),
            isLowerBound: awaiting.some((bucket) => bucket.isLowerBound),
          },
        });
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { summary, error };
}
