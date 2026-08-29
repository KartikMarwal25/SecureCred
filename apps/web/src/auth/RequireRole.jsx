import { Navigate } from 'react-router-dom';
import { ROLE } from '@securecred/shared';
import { useAuth } from './useAuth.js';
import { isDevAuthMode } from './AppAuthProvider.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

/** Route guard: requires an authenticated session with the given role. */
export function RequireRole({ role, children }) {
  const auth = useAuth();

  if (!auth.isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center px-12 py-32">
        <p className="text-[16px] leading-[24px] text-faint">Loading your account…</p>
      </div>
    );
  }

  if (!auth.isSignedIn) {
    return <Navigate to={isDevAuthMode ? '/dev-login' : '/sign-in'} replace />;
  }

  if (auth.role !== role) {
    return <Navigate to={LANDING_BY_ROLE[auth.role] ?? '/verify'} replace />;
  }

  return children;
}
