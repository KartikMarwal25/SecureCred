import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ROLE, institutionCodeSchema } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';
import { chooseRole, ApiError } from '../../api/client.js';
import { Logo } from '../../components/Logo.jsx';
import { BackButton } from '../../components/BackButton.jsx';
import { Button } from '../../components/Button.jsx';
import { CopyableValue } from '../../components/CopyableValue.jsx';
import { BuildingIcon } from '../../components/icons/BuildingIcon.jsx';
import { GraduationCapIcon } from '../../components/icons/GraduationCapIcon.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

const ROLE_OPTIONS = [
  {
    role: ROLE.STUDENT,
    icon: GraduationCapIcon,
    label: "I'm a student",
    description: 'View and share credentials once your institution issues them to you.',
  },
  {
    role: ROLE.INSTITUTION,
    icon: BuildingIcon,
    label: "I'm from an institution",
    description: 'Issue, manage, and track certificates on behalf of your institution.',
  },
];

/**
 * A brand-new signed-up account has no role until this page runs — see
 * apps/api/src/middleware/auth.mw.js and routes/auth.routes.js. Student
 * needs nothing further; institution needs a name + short code so the
 * backend can create (or join) that institution's row. On success this
 * does a full page navigation (not a client-side route change) so the
 * whole auth context remounts and re-fetches the now-set role fresh.
 */
export function RoleSelectionPage() {
  const auth = useAuth();
  const [pendingRole, setPendingRole] = useState(null);
  const [institutionName, setInstitutionName] = useState('');
  const [institutionCode, setInstitutionCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState(null);
  const [freshPendingRequest, setFreshPendingRequest] = useState(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  // Covers both a fresh submission (this session) and a returning visitor
  // who already has a live request (from /auth/me, once auth finishes
  // loading) — whichever is known first.
  const pendingRequest = freshPendingRequest ?? auth.pendingInstitutionRequest;
  // Left their institution (see SettingsPage.jsx) but keeps role_id —
  // matches the backend's own /choose-role guard (auth.routes.js): allowed
  // back in here, but only to pick an institution, not switch to student.
  const isDetachedInstitution = auth.role === ROLE.INSTITUTION && !auth.institutionId;

  if (isDevAuthMode) {
    return <Navigate to="/dev-login" replace />;
  }
  if (!auth.isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-12 py-32">
        <p className="text-[16px] leading-[24px] text-faint">Loading your account…</p>
      </div>
    );
  }
  if (!auth.isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }
  if (auth.role && !isDetachedInstitution) {
    return <Navigate to={LANDING_BY_ROLE[auth.role] ?? '/verify'} replace />;
  }

  const submitStudent = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await chooseRole({ role: ROLE.STUDENT });
      window.location.href = LANDING_BY_ROLE[ROLE.STUDENT];
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  // Step 1: validate, then pause on a confirmation screen instead of
  // submitting straight away — a typo'd institution code is otherwise
  // indistinguishable from "this institution doesn't exist yet" and
  // silently creates a brand-new institution, with no warning.
  const reviewInstitution = (event) => {
    event.preventDefault();
    const parsedCode = institutionCodeSchema.safeParse(institutionCode);
    if (!parsedCode.success) {
      setFieldError(parsedCode.error.issues[0]?.message ?? 'Enter a valid institution code.');
      return;
    }
    if (institutionName.trim().length < 2) {
      setFieldError("Enter your institution's full name.");
      return;
    }
    setFieldError(null);
    setConfirmingSubmit(true);
  };

  // Step 2: the actual submission, only reached after the user confirms.
  const submitInstitution = async () => {
    const parsedCode = institutionCodeSchema.safeParse(institutionCode);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await chooseRole({
        role: ROLE.INSTITUTION,
        institutionName: institutionName.trim(),
        institutionCode: parsedCode.data,
        accessCode: accessCode.trim() || undefined,
      });
      if (result.institutionAccessCode) {
        // Brand-new institution — pause here so the creator can save the
        // access code before it's gone; it's never shown again after this.
        setSubmitting(false);
        setNewAccessCode(result.institutionAccessCode);
        return;
      }
      if (result.pendingInstitutionRequest) {
        // Joining an existing institution now requires a staff member to
        // approve the request — not instant, on purpose.
        setSubmitting(false);
        setFreshPendingRequest(result.pendingInstitutionRequest);
        return;
      }
      window.location.href = LANDING_BY_ROLE[ROLE.INSTITUTION];
    } catch (err) {
      setSubmitting(false);
      setConfirmingSubmit(false);
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-12 py-32"
      style={{ backgroundImage: 'var(--gradient-hero)' }}
    >
      <div className="mx-auto mb-16 w-full max-w-[480px]">
        <BackButton />
      </div>
      <div className="animate-scale-in mx-auto flex w-full max-w-[480px] flex-col items-center gap-24 rounded-[16px] border border-edge bg-paper p-32 shadow-md">
        <Logo size="lg" />
        <div className="text-center">
          <h1 className="text-[24px] font-bold leading-[32px] text-ink">One more thing</h1>
          <p className="prose-copy mt-8 text-[16px] leading-[24px] text-muted">
            How will you be using SecureCred?
          </p>
        </div>

        {newAccessCode ? (
          <div className="flex w-full flex-col gap-16">
            <p className="text-[16px] leading-[24px] text-body">
              Your institution's account is ready. Save this access code — anyone else from your
              institution needs it to join as staff, and it's only shown here once.
            </p>
            <CopyableValue
              label="Institution access code"
              value={newAccessCode}
              truncate={false}
              gloss="Share this with your colleagues, not with students or the public."
            />
            <Button
              variant="primary"
              onClick={() => {
                window.location.href = LANDING_BY_ROLE[ROLE.INSTITUTION];
              }}
            >
              Continue to dashboard
            </Button>
          </div>
        ) : pendingRequest ? (
          <div className="flex w-full flex-col items-center gap-16 text-center">
            <p className="text-[16px] leading-[24px] text-body">
              Your request to join <strong>{pendingRequest.institutionName}</strong> is waiting for
              an existing staff member to approve it. You'll get access as soon as someone does —
              no need to submit again.
            </p>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Check again
            </Button>
            <button
              type="button"
              onClick={() => auth.signOut()}
              className="text-[14px] font-bold leading-[20px] text-brand hover:underline"
            >
              Sign out
            </button>
          </div>
        ) : confirmingSubmit ? (
          <div className="flex w-full flex-col gap-16">
            <div className="rounded-[8px] border border-edge bg-surface p-16">
              <p className="text-[14px] leading-[20px] text-body">
                You entered institution code{' '}
                <span className="font-mono font-bold text-ink">{institutionCode}</span>.
              </p>
              <ul className="mt-8 flex flex-col gap-4 text-[14px] leading-[20px] text-faint">
                <li>
                  · If this exactly matches an existing institution, your request to join will be
                  sent to their staff for approval.
                </li>
                <li>
                  · If it does <strong>not</strong> match any existing institution, a brand-new one
                  called "{institutionName}" is created immediately, and you become its first
                  staff member.
                </li>
              </ul>
              <p className="mt-8 text-[14px] font-bold leading-[20px] text-ink">
                Double-check the spelling above before continuing — especially if you meant to
                join an institution that already exists.
              </p>
            </div>
            {submitError ? <p className="text-[14px] leading-[20px] text-bad">{submitError}</p> : null}
            <div className="flex flex-wrap gap-8">
              <Button variant="primary" onClick={submitInstitution} disabled={submitting}>
                {submitting ? 'Continuing…' : 'Yes, this is correct'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmingSubmit(false)}
                disabled={submitting}
              >
                Go back and check
              </Button>
            </div>
          </div>
        ) : pendingRole === ROLE.INSTITUTION || isDetachedInstitution ? (
          <form onSubmit={reviewInstitution} className="flex w-full flex-col gap-16">
            {isDetachedInstitution ? (
              <p className="text-[14px] leading-[20px] text-faint">
                You left your previous institution. Pick (or create) the one you meant to join —
                double-check the code this time.
              </p>
            ) : null}
            <div>
              <label
                htmlFor="institution-name"
                className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
              >
                Institution name
              </label>
              <input
                id="institution-name"
                type="text"
                value={institutionName}
                onChange={(event) => setInstitutionName(event.target.value)}
                placeholder="e.g. Swami Keshvanand Institute of Technology"
                className="mt-4 min-h-[44px] w-full rounded-[8px] border border-edge-ctl bg-paper px-12 py-8 text-[16px] leading-[24px] text-body placeholder:text-faint"
              />
            </div>
            <div>
              <label
                htmlFor="institution-code"
                className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
              >
                Institution code
              </label>
              <input
                id="institution-code"
                type="text"
                value={institutionCode}
                onChange={(event) => setInstitutionCode(event.target.value.toUpperCase())}
                placeholder="e.g. SKIT"
                className="mt-4 min-h-[44px] w-full rounded-[8px] border border-edge-ctl bg-paper px-12 py-8 font-mono text-[15px] leading-[22px] text-body placeholder:text-faint"
              />
              <p className="mt-4 text-[14px] leading-[20px] text-faint">
                3-8 letters/numbers. If your institution already has an account, use the same code
                to join it — otherwise a new one is created.
              </p>
            </div>
            <div>
              <label
                htmlFor="access-code"
                className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
              >
                Access code
              </label>
              <input
                id="access-code"
                type="text"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Only needed if joining an existing institution"
                className="mt-4 min-h-[44px] w-full rounded-[8px] border border-edge-ctl bg-paper px-12 py-8 font-mono text-[15px] leading-[22px] text-body placeholder:text-faint"
              />
              <p className="mt-4 text-[14px] leading-[20px] text-faint">
                Ask whoever set up your institution's account for this code. Joining doesn't grant
                access immediately — an existing staff member needs to approve your request first.
                Leave it blank if you're setting up your institution for the first time — you'll
                get a code to share with your colleagues once you continue.
              </p>
            </div>
            {fieldError ? <p className="text-[14px] leading-[20px] text-bad">{fieldError}</p> : null}
            {submitError ? <p className="text-[14px] leading-[20px] text-bad">{submitError}</p> : null}
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Setting up your institution…' : 'Continue'}
            </Button>
            {isDetachedInstitution ? null : (
              <button
                type="button"
                onClick={() => setPendingRole(null)}
                className="text-[14px] font-bold leading-[20px] text-brand hover:underline"
              >
                Back
              </button>
            )}
          </form>
        ) : (
          <div className="flex w-full flex-col gap-12">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.role}
                type="button"
                disabled={submitting}
                onClick={() =>
                  option.role === ROLE.STUDENT ? submitStudent() : setPendingRole(ROLE.INSTITUTION)
                }
                className="group flex min-h-[44px] items-center gap-16 rounded-[12px] border border-edge bg-paper p-16 text-left shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[8px] bg-surface text-brand transition-colors group-hover:bg-brand group-hover:text-paper">
                  <option.icon className="h-20 w-20" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-bold leading-[24px] text-ink">
                    {option.label}
                  </span>
                  <span className="block text-[14px] leading-[20px] text-muted">
                    {option.description}
                  </span>
                </span>
              </button>
            ))}
            {submitError ? <p className="text-[14px] leading-[20px] text-bad">{submitError}</p> : null}
          </div>
        )}
      </div>
    </main>
  );
}
