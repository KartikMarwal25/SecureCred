import { useCallback, useEffect, useState } from 'react';
import { VERIFY_OUTCOME } from '@securecred/shared';
import { getActivityStats, ApiError } from '../../api/client.js';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';
import { formatDate } from '../../lib/formatDate.js';

export function ActivityPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getActivityStats();
      setStats(data);
    } catch (err) {
      setStats(null);
      setError(err instanceof ApiError ? err : new ApiError('Activity is not available right now.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const series = stats?.seriesByDay ?? [];
  const mostVerified = stats?.mostVerified ?? [];
  const outcomeDistribution = stats?.outcomeDistribution ?? [];
  const maxCount = Math.max(1, ...series.map((point) => point.count));

  return (
    <div className="flex flex-col gap-24">
      <h1 className="text-[24px] font-bold leading-[32px] text-ink">Activity</h1>

      {loading ? (
        <div className="flex flex-col gap-12">
          <Skeleton className="h-[160px] w-full" />
          <Skeleton className="h-[120px] w-full" />
        </div>
      ) : error ? (
        <div className="rounded-[6px] border border-edge bg-neutral-bg p-16">
          <p className="text-[16px] leading-[24px] text-neutral">
            Verification activity could not be loaded right now.
          </p>
          <Button variant="secondary" className="mt-16" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <section className="rounded-[6px] border border-edge bg-paper p-16">
            <h2 className="text-[18px] font-bold leading-[26px] text-ink">
              Verifications over time
            </h2>
            {series.length === 0 ? (
              <p className="mt-16 text-[16px] leading-[24px] text-muted">
                No verifications have been recorded yet.
              </p>
            ) : (
              <>
                <div
                  className="mt-16 flex items-end gap-8 overflow-x-auto pb-8"
                  role="img"
                  aria-label="Bar chart of verifications per day"
                >
                  {series.map((point) => (
                    <div key={point.date} className="flex w-32 shrink-0 flex-col items-center gap-4">
                      <div
                        className="w-full rounded-[4px] bg-brand"
                        style={{ height: `${Math.max(4, (point.count / maxCount) * 120)}px` }}
                      />
                      <span className="text-[12px] leading-[16px] text-faint">{point.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-16 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-[14px] leading-[20px]">
                    <thead>
                      <tr className="border-b border-edge">
                        <th className="px-8 py-4 font-bold uppercase tracking-[0.4px] text-faint">
                          Date
                        </th>
                        <th className="px-8 py-4 font-bold uppercase tracking-[0.4px] text-faint">
                          Verifications
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((point) => (
                        <tr key={point.date}>
                          <td className="px-8 py-4 text-body">{formatDate(point.date)}</td>
                          <td className="px-8 py-4 text-body">{point.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="rounded-[6px] border border-edge bg-paper p-16">
            <h2 className="text-[18px] font-bold leading-[26px] text-ink">
              Most-verified certificates
            </h2>
            {mostVerified.length === 0 ? (
              <p className="mt-16 text-[16px] leading-[24px] text-muted">
                No certificates have been verified yet.
              </p>
            ) : (
              <ul className="mt-16 flex flex-col gap-12">
                {mostVerified.map((row) => (
                  <li
                    key={row.certificateNumber}
                    className="flex flex-wrap items-baseline justify-between gap-8"
                  >
                    <span className="font-mono text-[15px] leading-[22px] text-body">
                      {row.certificateNumber}
                    </span>
                    <span className="text-[16px] leading-[24px] text-body">{row.title}</span>
                    <span className="text-[14px] leading-[20px] text-faint">{row.count} checks</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[6px] border border-edge bg-paper p-16">
            <h2 className="text-[18px] font-bold leading-[26px] text-ink">Outcome distribution</h2>
            {outcomeDistribution.length === 0 ? (
              <p className="mt-16 text-[16px] leading-[24px] text-muted">No outcomes to show yet.</p>
            ) : (
              <ul className="mt-16 flex flex-col gap-8">
                {outcomeDistribution.map((row) => (
                  <li key={row.outcome} className="flex flex-wrap items-baseline gap-12">
                    <span className="text-[16px] font-bold leading-[24px] text-body">{row.outcome}</span>
                    <span className="text-[16px] leading-[24px] text-body">{row.count}</span>
                    {row.outcome === VERIFY_OUTCOME.TAMPERED ? (
                      <span className="prose-copy text-[14px] leading-[20px] text-faint">
                        A document was presented that did not match what the institution issued.
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
