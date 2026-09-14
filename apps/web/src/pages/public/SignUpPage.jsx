import { Navigate } from 'react-router-dom';
import { SignUp } from '@clerk/clerk-react';
import { ROLE } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';
import { Logo } from '../../components/Logo.jsx';
import { BackButton } from '../../components/BackButton.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

/**
 * Self-service sign-up — students only. An institution account is always
 * provisioned out-of-band (see db/seeds/seed.js and docs/CLERK_SETUP.md);
 * anyone who signs up here defaults to the student role (see auth.mw.js /
 * webhooks.routes.js on the API side) and can view their credential gallery
 * immediately — it starts empty until an institution issues them something.
 */
export function SignUpPage() {
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
          <h1 className="text-[24px] font-bold leading-[32px] text-ink">Create your account</h1>
          <p className="mt-8 text-[16px] leading-[24px] text-muted">
            For students — view and share credentials once your institution issues them.
          </p>
        </div>
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
      </div>
    </main>
  );
}
