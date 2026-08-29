import { Navigate } from 'react-router-dom';
import { ROLE } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';
import { Button } from '../../components/Button.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

/** Dev-only stand-in for Clerk's hosted sign-in, used when no publishable key is set. */
export function DevLoginPage() {
  const auth = useAuth();

  if (!isDevAuthMode) {
    return <Navigate to="/sign-in" replace />;
  }

  if (auth.isSignedIn) {
    return <Navigate to={LANDING_BY_ROLE[auth.role] ?? '/verify'} replace />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col justify-center gap-24 px-12 py-32">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Dev sign-in</h1>
        <p className="prose-copy mt-8 text-[16px] leading-[24px] text-muted">
          Local development only. Choose a role to simulate a signed-in session — no external
          account is used.
        </p>
      </div>
      <div className="flex flex-col gap-12 sm:flex-row">
        <Button variant="primary" className="flex-1" onClick={() => auth.devLogin(ROLE.INSTITUTION)}>
          Continue as institution
        </Button>
        <Button variant="primary" className="flex-1" onClick={() => auth.devLogin(ROLE.STUDENT)}>
          Continue as student
        </Button>
      </div>
    </main>
  );
}
