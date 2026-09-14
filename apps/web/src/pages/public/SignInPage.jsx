import { Navigate } from 'react-router-dom';
import { SignIn } from '@clerk/clerk-react';
import { ROLE } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';
import { Logo } from '../../components/Logo.jsx';
import { BackButton } from '../../components/BackButton.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

export function SignInPage() {
  const auth = useAuth();

  if (isDevAuthMode) {
    return <Navigate to="/dev-login" replace />;
  }

  if (auth.isLoaded && auth.isSignedIn) {
    return <Navigate to={LANDING_BY_ROLE[auth.role] ?? '/choose-role'} replace />;
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-12 py-32"
      style={{ backgroundImage: 'var(--gradient-hero)' }}
    >
      <div className="mx-auto mb-16 w-full max-w-[420px]">
        <BackButton />
      </div>
      <div className="animate-scale-in mx-auto flex w-full max-w-[420px] flex-col items-center gap-24 rounded-[16px] border border-edge bg-paper p-32 shadow-md">
        <Logo size="lg" />
        <div className="text-center">
          <h1 className="text-[24px] font-bold leading-[32px] text-ink">Welcome back</h1>
          <p className="mt-8 text-[16px] leading-[24px] text-muted">
            Sign in to SecureCred to continue.
          </p>
        </div>
        <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
      </div>
    </main>
  );
}
