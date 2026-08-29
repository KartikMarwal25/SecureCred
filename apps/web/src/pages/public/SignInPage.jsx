import { Navigate } from 'react-router-dom';
import { SignIn } from '@clerk/clerk-react';
import { ROLE } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

export function SignInPage() {
  const auth = useAuth();

  if (isDevAuthMode) {
    return <Navigate to="/dev-login" replace />;
  }

  if (auth.isLoaded && auth.isSignedIn) {
    return <Navigate to={LANDING_BY_ROLE[auth.role] ?? '/verify'} replace />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center px-12 py-32">
      <SignIn routing="path" path="/sign-in" />
    </main>
  );
}
