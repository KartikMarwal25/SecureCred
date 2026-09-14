import { useCallback, useEffect, useState } from 'react';
import { VERIFY_OUTCOME } from '@securecred/shared';
import { getActivityStats, ApiError } from '../../api/client.js';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Reveal } from '../../components/Reveal.jsx';
import { useInView } from '../../hooks/useInView.js';
import { LinkIcon } from '../../components/icons/LinkIcon.jsx';
import { CheckIcon } from '../../components/icons/CheckIcon.jsx';
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
  const totalVerifications = series.reduce((sum, point) => sum + point.count, 0);
  const verifiedCount =
    outcomeDistribution.find((row) => row.outcome === VERIFY_OUTCOME.VERIFIED)?.count ?? 0;

  return (
    <div className="flex flex-col gap-24">
      <h1 className="text-[24px] font-bold leading-[32px] text-ink">Activity</h1>

      {loading ? (
        <div className="flex flex-col gap-12">
          <Skeleton className="h-[160px] w-full rounded-[16px]" />
          <Skeleton className="h-[120px] w-full rounded-[16px]" />
        </div>
      ) : error ? (
        <div className="rounded-[16px] border border-edge bg-neutral-bg p-16 shadow-xs">
          <p className="text-[16px] leading-[24px] text-neutral">
            Verification activity could not be loaded right now.
          </p>
          <Button variant="secondary" className="mt-16" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="stagger-children grid grid-cols-1 gap-16 sm:grid-cols-2">
            <StatCard
              icon={<LinkIcon className="h-20 w-20 text-paper" />}
              label="Total verifications"
              value={totalVerifications}
              tone="brand"
            />
            <StatCard
              icon={<CheckIcon className="h-20 w-20 text-brand" />}
              label="Verified outcomes"
              value={verifiedCount}
              tone="surface"
            />
          </div>

          <Reveal
            as="section"
            className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24"
          >
            <h2 className="text-[18px] font-bold leading-[26px] text-ink">
              Verifications over time
            </h2>
            {series.length === 0 ? (
              <p className="mt-16 text-[16px] leading-[24px] text-muted">
                No verifications have been recorded yet.
              </p>
            ) : (
              <>
                <ActivityBarChart series={series} maxCount={maxCount} />
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
          </Reveal>

          <Reveal
            as="section"
            className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24"
          >
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
                    className="flex flex-wrap items-baseline justify-between gap-8 rounded-[8px] px-8 py-4 transition-colors duration-150 hover:bg-surface"
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
          </Reveal>

          <Reveal
            as="section"
            className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24"
          >
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
          </Reveal>
        </>
      )}
    </div>
  );
}

/** Bars grow from 0 height once the chart scrolls into view, rather than rendering at full height immediately. */
function ActivityBarChart({ series, maxCount }) {
  const [ref, isVisible] = useInView();
  return (
    <div
      ref={ref}
      className="mt-16 flex items-end gap-8 overflow-x-auto pb-8"
      role="img"
      aria-label="Bar chart of verifications per day"
    >
      {series.map((point) => (
        <div key={point.date} className="flex w-32 shrink-0 flex-col items-center gap-4">
          <div
            className="w-full rounded-[4px] bg-brand transition-[height] duration-700 ease-out"
            style={{ height: isVisible ? `${Math.max(4, (point.count / maxCount) * 120)}px` : '0px' }}
          />
          <span className="text-[12px] leading-[16px] text-faint">{point.count}</span>
        </div>
      ))}
    </div>
  );
}
