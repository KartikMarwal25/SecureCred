import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CERT_STATE } from '@securecred/shared';
import { listCertificates, ApiError } from '../../api/client.js';
import { useRegistrySummary } from '../../hooks/useRegistrySummary.js';
import { DataTable } from '../../components/DataTable.jsx';
import { StateChip } from '../../components/StateChip.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { EmptyState } from '../../components/EmptyState.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Reveal } from '../../components/Reveal.jsx';
import { StatCard } from '../../components/StatCard.jsx';
import { Button, buttonClassName } from '../../components/Button.jsx';
import { formatDate } from '../../lib/formatDate.js';
import { ShieldIcon } from '../../components/icons/ShieldIcon.jsx';
import { ClockIcon } from '../../components/icons/ClockIcon.jsx';
import { BarredCircleIcon } from '../../components/icons/BarredCircleIcon.jsx';

const PAGE_SIZE = 20;
const STATE_OPTIONS = Object.values(CERT_STATE);
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);

function summaryLabel(bucket) {
  if (!bucket) return '—';
  return bucket.isLowerBound ? `${bucket.count}+` : String(bucket.count);
}

export function RegistryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const course = searchParams.get('course') || '';
  const year = searchParams.get('year') || '';
  const page = Number(searchParams.get('page') || '0');

  const [searchDraft, setSearchDraft] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cursorStackRef = useRef(['']); // cursorStackRef.current[pageIndex] = cursor used to fetch that page

  const { summary } = useRegistrySummary();

  const hasActiveFilters = Boolean(status || q || course || year);

  const updateParams = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === '' || value === undefined || value === null) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const applyFilters = useCallback(
    (patch) => {
      cursorStackRef.current = [''];
      updateParams({ ...patch, page: 0 });
    },
    [updateParams],
  );

  const handleSearchSubmit = useCallback(
    (event) => {
      event.preventDefault();
      applyFilters({ q: searchDraft.trim() });
    },
    [applyFilters, searchDraft],
  );

  const handleClearFilters = useCallback(() => {
    setSearchDraft('');
    cursorStackRef.current = [''];
    setSearchParams({});
  }, [setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const cursor = cursorStackRef.current[page] || undefined;
    const params = { limit: PAGE_SIZE, cursor, status: status || undefined, q: q || undefined };
    if (year) {
      params.from = `${year}-01-01`;
      params.to = `${year}-12-31`;
    }

    listCertificates(params)
      .then((data) => {
        if (cancelled) return;
        let items = data.items ?? [];
        // Best-effort client-side narrowing: the documented list contract has
        // no `course` query param, so this filters the fetched page locally
        // rather than silently ignoring the control.
        if (course) {
          items = items.filter((item) => item.attributes?.course === course);
        }
        setRows(items);
        setNextCursor(data.nextCursor ?? null);
        if (data.nextCursor) {
          cursorStackRef.current[page + 1] = data.nextCursor;
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError('Could not load certificates.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, status, q, course, year]);

  const programmeOptions = useMemo(() => {
    const values = new Set(rows.map((row) => row.attributes?.course).filter(Boolean));
    if (course) values.add(course);
    return Array.from(values).sort();
  }, [rows, course]);

  const columns = [
    {
      key: 'certificateNumber',
      header: 'Identifier',
      mono: true,
      render: (row) => row.certificateNumber,
    },
    { key: 'holderName', header: 'Holder', render: (row) => row.holderName },
    { key: 'title', header: 'Certificate title', render: (row) => row.title },
    { key: 'issueDate', header: 'Date of issue', render: (row) => formatDate(row.issueDate) },
    { key: 'status', header: 'Lifecycle state', render: (row) => <StateChip state={row.status} /> },
  ];

  const from = rows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = page * PAGE_SIZE + rows.length;

  return (
    <div className="flex flex-col gap-24">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Certificates</h1>
        <p className="mt-8 text-[16px] leading-[24px] text-muted">
          {summary
            ? `${summaryLabel(summary.total)} issued · ${summaryLabel(summary.awaitingAnchor)} awaiting anchor · ${summaryLabel(summary.revoked)} revoked`
            : 'Loading summary…'}
        </p>
      </div>

      {summary ? (
        <div className="stagger-children grid grid-cols-1 gap-16 sm:grid-cols-3">
          <StatCard
            icon={<ShieldIcon className="h-20 w-20 text-paper" />}
            label="Total issued"
            value={summary.total.count}
            suffix={summary.total.isLowerBound ? '+' : ''}
            tone="brand"
          />
          <StatCard
            icon={<ClockIcon className="h-20 w-20 text-brand" />}
            label="Awaiting anchor"
            value={summary.awaitingAnchor.count}
            suffix={summary.awaitingAnchor.isLowerBound ? '+' : ''}
            tone="surface"
          />
          <StatCard
            icon={<BarredCircleIcon className="h-20 w-20 text-brand" />}
            label="Revoked"
            value={summary.revoked.count}
            suffix={summary.revoked.isLowerBound ? '+' : ''}
            tone="surface"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-16 sm:grid-cols-3">
          <Skeleton className="h-[112px] w-full rounded-[16px]" />
          <Skeleton className="h-[112px] w-full rounded-[16px]" />
          <Skeleton className="h-[112px] w-full rounded-[16px]" />
        </div>
      )}

      <form onSubmit={handleSearchSubmit} className="flex flex-col gap-8 sm:flex-row">
        <label htmlFor="registry-search" className="sr-only">
          Search certificates
        </label>
        <input
          id="registry-search"
          type="text"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search by holder name, identifier, or title"
          className="min-h-[44px] flex-1 rounded-[4px] border border-edge-ctl bg-paper px-12 py-8 text-[16px] leading-[24px] text-body placeholder:text-faint"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Reveal className="lg:flex lg:items-start lg:gap-24" threshold={0}>
        <aside className="lg:w-[240px] lg:shrink-0">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className="mb-12 min-h-[44px] w-full rounded-[4px] border border-edge-ctl px-12 text-left text-[16px] font-bold text-brand lg:hidden"
          >
            Filters {filtersOpen ? '▲' : '▼'}
          </button>
          <div className={`${filtersOpen ? 'flex' : 'hidden'} flex-col gap-16 rounded-[6px] border border-edge bg-surface p-16 lg:flex`}>
            <div>
              <label htmlFor="filter-state" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                State
              </label>
              <select
                id="filter-state"
                value={status}
                onChange={(event) => applyFilters({ status: event.target.value })}
                className="mt-4 min-h-[44px] w-full rounded-[4px] border border-edge-ctl bg-paper px-8 py-8 text-[16px] leading-[24px] text-body"
              >
                <option value="">All</option>
                {STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-course" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Programme
              </label>
              <select
                id="filter-course"
                value={course}
                onChange={(event) => applyFilters({ course: event.target.value })}
                className="mt-4 min-h-[44px] w-full rounded-[4px] border border-edge-ctl bg-paper px-8 py-8 text-[16px] leading-[24px] text-body"
              >
                <option value="">All</option>
                {programmeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-year" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Issue year
              </label>
              <select
                id="filter-year"
                value={year}
                onChange={(event) => applyFilters({ year: event.target.value })}
                className="mt-4 min-h-[44px] w-full rounded-[4px] border border-edge-ctl bg-paper px-8 py-8 text-[16px] leading-[24px] text-body"
              >
                <option value="">All</option>
                {YEAR_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="flex flex-col gap-12">
              <Skeleton className="h-[48px] w-full" />
              <Skeleton className="h-[48px] w-full" />
              <Skeleton className="h-[48px] w-full" />
            </div>
          ) : error ? (
            <EmptyState
              title="Certificates could not be loaded right now. Check your connection and try again."
              action={
                <Button variant="secondary" onClick={() => applyFilters({})}>
                  Try again
                </Button>
              }
            />
          ) : rows.length === 0 && !hasActiveFilters && page === 0 ? (
            <EmptyState
              title="You haven't issued any credentials yet."
              action={
                <Link to="/app/issue" className={buttonClassName('primary')}>
                  Issue your first credential
                </Link>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No credentials match these filters."
              action={
                <Button variant="secondary" onClick={handleClearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-16">
              <DataTable
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.certificateId}
                renderActions={(row) => (
                  <Link to={`/app/certificate/${row.certificateId}`} className={buttonClassName('secondary')}>
                    Open
                  </Link>
                )}
              />
              <Pagination
                from={from}
                to={to}
                total={null}
                hasPrev={page > 0}
                hasNext={Boolean(nextCursor)}
                onPrev={() => updateParams({ page: Math.max(0, page - 1) })}
                onNext={() => updateParams({ page: page + 1 })}
              />
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}
