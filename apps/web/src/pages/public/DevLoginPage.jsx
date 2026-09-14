import { Navigate } from 'react-router-dom';
import { ROLE } from '@securecred/shared';
import { useAuth } from '../../auth/useAuth.js';
import { isDevAuthMode } from '../../auth/AppAuthProvider.jsx';
import { Logo } from '../../components/Logo.jsx';
import { BackButton } from '../../components/BackButton.jsx';
import { BuildingIcon } from '../../components/icons/BuildingIcon.jsx';
import { GraduationCapIcon } from '../../components/icons/GraduationCapIcon.jsx';
import { ArrowRightIcon } from '../../components/icons/ArrowRightIcon.jsx';

const LANDING_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

const ROLE_OPTIONS = [
  {
    role: ROLE.INSTITUTION,
    icon: BuildingIcon,
    label: 'Continue as institution',
    description: 'Issue, manage, and track your credentials.',
  },
  {
    role: ROLE.STUDENT,
    icon: GraduationCapIcon,
    label: 'Continue as student',
    description: 'View and share your credentials.',
  },
];

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
          <h1 className="text-[24px] font-bold leading-[32px] text-ink">Dev sign-in</h1>
          <p className="prose-copy mt-8 text-[16px] leading-[24px] text-muted">
            Local development only. Choose a role to simulate a signed-in session — no external
            account is used.
          </p>
        </div>
        <div className="flex w-full flex-col gap-12">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.role}
              type="button"
              onClick={() => auth.devLogin(option.role)}
              className="group flex min-h-[44px] items-center gap-16 rounded-[12px] border border-edge bg-paper p-16 text-left shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
            >
              <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full bg-surface text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-paper">
                <option.icon className="h-20 w-20" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold leading-[24px] text-ink">
                  {option.label}
                </span>
                <span className="block text-[14px] leading-[20px] text-faint">
                  {option.description}
                </span>
              </span>
              <ArrowRightIcon className="h-16 w-16 shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-2 group-hover:text-brand" />
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
