import { useCallback, useEffect, useState } from 'react';
import {
  getMyInstitution,
  rotateInstitutionAccessCode,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  leaveInstitution,
  ApiError,
} from '../../api/client.js';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';
import { CopyableValue } from '../../components/CopyableValue.jsx';
import { formatDate } from '../../lib/formatDate.js';

function JoinRequestsPanel() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);
  const [decidingId, setDecidingId] = useState(null);
  const [decideError, setDecideError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await listJoinRequests();
      setRequests(data.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('Could not load join requests.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecide = async (requestId, action) => {
    setDecidingId(requestId);
    setDecideError(null);
    try {
      if (action === 'approve') {
        await approveJoinRequest(requestId);
      } else {
        await rejectJoinRequest(requestId);
      }
      await load();
    } catch (err) {
      setDecideError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setDecidingId(null);
    }
  };

  const hasPending = Boolean(requests && requests.length > 0);

  return (
    <div
      className={`rounded-[16px] border p-16 shadow-sm sm:p-24 ${
        hasPending ? 'border-bad bg-bad-bg' : 'border-edge bg-paper'
      }`}
    >
      <div className="flex items-center gap-8">
        <p className="text-[18px] font-bold leading-[26px] text-ink">Pending join requests</p>
        {hasPending ? (
          <span className="animate-pulse flex h-24 min-w-[24px] items-center justify-center rounded-full bg-bad px-6 text-[13px] font-bold leading-none text-paper">
            {requests.length > 9 ? '9+' : requests.length}
          </span>
        ) : null}
      </div>
      <p className="mt-4 text-[14px] leading-[20px] text-faint">
        Anyone who supplies the correct access code lands here first — they get no access at all
        until an existing staff member approves them.
      </p>

      {error ? (
        <p className="mt-16 text-[14px] leading-[20px] text-bad">{error.message}</p>
      ) : requests === null ? (
        <Skeleton className="mt-16 h-[64px] w-full rounded-[8px]" />
      ) : requests.length === 0 ? (
        <p className="mt-16 text-[14px] leading-[20px] text-faint">No pending requests right now.</p>
      ) : (
        <ul className="mt-16 flex flex-col gap-12">
          {requests.map((request) => (
            <li
              key={request.requestId}
              className="flex flex-col gap-8 rounded-[8px] border border-edge bg-surface p-12 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-[16px] font-bold leading-[24px] text-ink">{request.fullName}</p>
                <p className="text-[14px] leading-[20px] text-faint">
                  {request.email} · Requested {formatDate(request.requestedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-8">
                <Button
                  variant="secondary"
                  onClick={() => handleDecide(request.requestId, 'approve')}
                  disabled={decidingId === request.requestId}
                >
                  {decidingId === request.requestId ? 'Approving…' : 'Approve'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDecide(request.requestId, 'reject')}
                  disabled={decidingId === request.requestId}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decideError ? <p className="mt-12 text-[14px] leading-[20px] text-bad">{decideError}</p> : null}
    </div>
  );
}

export function SettingsPage() {
  const [institution, setInstitution] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState(null);
  const [newAccessCode, setNewAccessCode] = useState(null);

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyInstitution();
      setInstitution(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err : new ApiError('Could not load your institution.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRotate = async () => {
    setRotating(true);
    setRotateError(null);
    try {
      const result = await rotateInstitutionAccessCode();
      setNewAccessCode(result.accessCode);
      setConfirming(false);
    } catch (err) {
      setRotateError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setRotating(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveInstitution();
      // Full page navigation, not a client-side route change — the whole
      // auth context needs to remount and re-fetch scope fresh, same
      // reasoning as everywhere else a role/institution changes.
      window.location.href = '/choose-role';
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setLeaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-16">
        <Skeleton className="h-[32px] w-2/3" />
        <Skeleton className="h-[160px] w-full rounded-[16px]" />
      </div>
    );
  }

  if (loadError || !institution) {
    return (
      <div className="rounded-[16px] border border-edge bg-neutral-bg p-16 shadow-xs">
        <p className="text-[16px] leading-[24px] text-neutral">
          This could not be loaded. Check your connection and try again.
        </p>
        <Button variant="secondary" className="mt-16" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up flex flex-col gap-24">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Institution settings</h1>
        <p className="mt-8 text-[16px] leading-[24px] text-muted">
          {institution.institutionName} · Code {institution.institutionCode}
        </p>
      </div>

      <JoinRequestsPanel />

      <div className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24">
        <p className="text-[18px] font-bold leading-[26px] text-ink">Access code</p>
        <p className="mt-4 text-[14px] leading-[20px] text-faint">
          Anyone joining your institution as staff needs this code, in addition to the code{' '}
          <span className="font-mono">{institution.institutionCode}</span>. Rotating it immediately
          invalidates the current one — any colleague part-way through signing up will need the new
          code.
        </p>

        {newAccessCode ? (
          <div className="mt-16">
            <CopyableValue
              label="New institution access code"
              value={newAccessCode}
              truncate={false}
              gloss="Share this with your colleagues now — it won't be shown again after you leave this page."
            />
          </div>
        ) : confirming ? (
          <div className="mt-16 flex flex-col gap-12 rounded-[8px] border border-edge bg-surface p-16">
            <p className="text-[14px] leading-[20px] text-body">
              This cannot be undone, and the current code will stop working immediately. Continue?
            </p>
            {rotateError ? <p className="text-[14px] leading-[20px] text-bad">{rotateError}</p> : null}
            <div className="flex flex-wrap gap-8">
              <Button variant="destructive" onClick={handleRotate} disabled={rotating}>
                {rotating ? 'Rotating…' : 'Yes, rotate the code'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={rotating}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-16">
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Rotate access code
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24">
        <p className="text-[18px] font-bold leading-[26px] text-ink">Leave this institution</p>
        <p className="mt-4 text-[14px] leading-[20px] text-faint">
          If you created or joined the wrong institution — a typo in the code is the usual cause —
          this detaches your account so you can go back and pick correctly. Your account and any
          certificates you've already issued or revoked are not affected. To get back in, you'll
          need to submit a new join request and be approved again (or create a new institution).
        </p>

        {confirmingLeave ? (
          <div className="mt-16 flex flex-col gap-12 rounded-[8px] border border-edge bg-surface p-16">
            <p className="text-[14px] leading-[20px] text-body">
              You'll immediately lose access to <strong>{institution.institutionName}</strong>.
              Continue?
            </p>
            {leaveError ? <p className="text-[14px] leading-[20px] text-bad">{leaveError}</p> : null}
            <div className="flex flex-wrap gap-8">
              <Button variant="destructive" onClick={handleLeave} disabled={leaving}>
                {leaving ? 'Leaving…' : 'Yes, leave this institution'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingLeave(false)} disabled={leaving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-16">
            <Button variant="destructive" onClick={() => setConfirmingLeave(true)}>
              Leave institution
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
