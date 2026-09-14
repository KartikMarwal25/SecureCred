import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { issueCertificatesBatch, getBatchStatus, ApiError } from '../../api/client.js';
import { Button } from '../../components/Button.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { BuildingIcon } from '../../components/icons/BuildingIcon.jsx';

const REQUIRED_COLUMNS = [
  'holderName',
  'holderEmail',
  'enrollmentNumber',
  'title',
  'certificateType',
  'course',
  'issueDate',
];

// A job still in PENDING/PROCESSING is polled; COMPLETED (or a fetch
// failure) stops polling.
const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'PROCESSING']);
const POLL_INTERVAL_MS = 2000;

const ROW_STATUS_LABELS = {
  PENDING: 'Pending',
  SUCCEEDED: 'Issued',
  FAILED: 'Failed',
};

const ROW_STATUS_CLASSES = {
  PENDING: 'text-faint',
  SUCCEEDED: 'text-ok',
  FAILED: 'text-bad',
};


export function BatchIssuePage() {
  const [fileName, setFileName] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [job, setJob] = useState(null); // { batchJobId, jobStatus, totalRows, processedRows, succeededRows, failedRows, rows }
  const fileInputRef = useRef(null);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setFileName('');
      setCsvContent('');
      return;
    }
    setSubmitError(null);
    setFileName(file.name);
    try {
      setCsvContent(await file.text());
    } catch {
      setSubmitError('Could not read that file. Please choose a CSV file and try again.');
      setCsvContent('');
    }
  };

  const pollStatus = useCallback(async (batchJobId) => {
    try {
      const data = await getBatchStatus(batchJobId);
      setJob(data);
      return data;
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Lost track of the batch job. Please refresh.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!job || !ACTIVE_JOB_STATUSES.has(job.jobStatus)) return undefined;
    const timer = setTimeout(() => pollStatus(job.batchJobId), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [job, pollStatus]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError(null);

    if (!csvContent) {
      setSubmitError('Choose a CSV file to upload.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await issueCertificatesBatch(csvContent);
      setSubmitting(false);
      pollStatus(result.batchJobId);
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  const startNewBatch = () => {
    setJob(null);
    setSubmitError(null);
    setFileName('');
    setCsvContent('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const columns = [
    { key: 'rowNumber', header: 'Row', render: (r) => r.rowNumber },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className={`font-bold ${ROW_STATUS_CLASSES[r.status] ?? 'text-faint'}`}>
          {ROW_STATUS_LABELS[r.status] ?? r.status}
        </span>
      ),
    },
    {
      key: 'result',
      header: 'Result',
      render: (r) => {
        if (r.status === 'SUCCEEDED' && r.certificateId) {
          return (
            <Link to={`/app/certificate/${r.certificateId}`} className="font-bold text-brand underline">
              View certificate
            </Link>
          );
        }
        if (r.status === 'FAILED') {
          return <span className="text-bad">{r.errorMessage || 'Issuance failed.'}</span>;
        }
        return <span className="text-faint">Waiting to be processed…</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-24">
      <h1 className="text-[24px] font-bold leading-[32px] text-ink">Batch-issue credentials</h1>

      <div className="flex flex-col gap-24 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-24 lg:w-[320px] lg:shrink-0">
          <div className="rounded-[16px] border border-edge bg-paper p-16 shadow-xs">
            <div className="flex items-center gap-12">
              <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[8px] bg-brand text-paper">
                <BuildingIcon className="h-20 w-20" />
              </span>
              <p className="text-[16px] font-bold leading-[24px] text-ink">Upload a CSV of rows</p>
            </div>
            <p className="mt-12 text-[14px] leading-[20px] text-faint">
              Each row becomes one certificate, issued the same way as the single-credential form.
              Up to 500 rows per file. The header row must include these columns:
            </p>
            <ul className="mt-8 flex flex-wrap gap-4">
              {REQUIRED_COLUMNS.map((col) => (
                <li
                  key={col}
                  className="rounded-full border border-edge-ctl px-8 py-4 font-mono text-[12px] leading-[16px] text-body"
                >
                  {col}
                </li>
              ))}
            </ul>
            <p className="mt-12 text-[14px] leading-[20px] text-faint">
              `gradeOrResult` is optional. One bad row does not stop the rest of the batch — each
              row&rsquo;s outcome is reported individually below.
            </p>
          </div>
        </div>

        <div className="min-w-0 flex-1 rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24">
          {submitError ? (
            <div role="alert" className="mb-24 rounded-[12px] border border-bad bg-bad-bg p-16">
              <p className="text-[16px] font-bold leading-[24px] text-bad">{submitError}</p>
            </div>
          ) : null}

          {!job ? (
            <form onSubmit={handleSubmit} noValidate>
              <label
                htmlFor="field-batch-csv"
                className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
              >
                CSV file
              </label>
              <input
                id="field-batch-csv"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="mt-8 block w-full text-[14px] text-body file:mr-12 file:min-h-[44px] file:rounded-[8px] file:border file:border-edge-ctl file:bg-paper file:px-16 file:font-bold file:text-brand"
              />
              {fileName ? (
                <p className="mt-8 text-[14px] leading-[20px] text-faint">Selected: {fileName}</p>
              ) : null}

              <div className="mt-24">
                <Button type="submit" variant="primary" disabled={submitting || !csvContent}>
                  {submitting ? 'Uploading…' : 'Start batch issuance'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-16">
              <div className="flex flex-wrap items-center justify-between gap-12">
                <div>
                  <p className="text-[16px] font-bold leading-[24px] text-ink">
                    {job.jobStatus === 'COMPLETED' ? 'Batch complete' : 'Processing batch…'}
                  </p>
                  <p className="text-[14px] leading-[20px] text-faint">
                    {job.processedRows} of {job.totalRows} rows processed — {job.succeededRows} issued,{' '}
                    {job.failedRows} failed.
                  </p>
                </div>
                {job.jobStatus === 'COMPLETED' ? (
                  <Button type="button" variant="secondary" onClick={startNewBatch}>
                    Start another batch
                  </Button>
                ) : null}
              </div>

              <div className="h-8 w-full overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-300"
                  style={{
                    width: `${job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0}%`,
                  }}
                />
              </div>

              <DataTable columns={columns} rows={job.rows} getRowKey={(r) => r.rowNumber} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
