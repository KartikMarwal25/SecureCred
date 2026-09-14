import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth.js';
import { Logo } from '../../components/Logo.jsx';
import { BackButton } from '../../components/BackButton.jsx';
import { listJoinRequests } from '../../api/client.js';

const NAV_ITEMS = [
  { to: '/app/registry', label: 'Certificates' },
  { to: '/app/issue', label: 'Issue credential' },
  { to: '/app/activity', label: 'Activity' },
  { to: '/app/settings', label: 'Settings' },
];

// How often to re-check for new join requests while anywhere in the
// institution area — not tied to the Settings page itself, so the badge
// stays visible (and current) no matter where staff are working.
const PENDING_CHECK_INTERVAL_MS = 30_000;

export function InstitutionLayout() {
  const auth = useAuth();
  const initial = auth.email ? auth.email.charAt(0).toUpperCase() : '?';
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const checkPending = () => {
      listJoinRequests()
        .then((data) => {
          if (!cancelled) setPendingCount(data.items?.length ?? 0);
        })
        .catch(() => {
          // Silent — this is a passive badge, not a page the user is looking at.
        });
    };
    checkPending();
    const interval = setInterval(checkPending, PENDING_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-edge bg-paper px-12 py-16 sm:px-16 md:px-24">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-16 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-16">
            <BackButton label="" className="!gap-0" />
            <Logo />
          </div>
          <nav className="flex flex-wrap gap-4" aria-label="Institution navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex min-h-[44px] items-center rounded-full px-16 text-[16px] font-bold leading-[24px] transition-colors duration-200 ${
                    isActive ? 'bg-brand text-paper' : 'text-brand hover:bg-surface'
                  }`
                }
              >
                {item.label}
                {item.to === '/app/settings' && pendingCount > 0 ? (
                  <span
                    className="animate-pulse absolute -right-4 -top-4 flex h-20 min-w-[20px] items-center justify-center rounded-full border-2 border-paper bg-bad px-4 text-[11px] font-bold leading-none text-paper"
                    aria-label={`${pendingCount} pending join request${pendingCount === 1 ? '' : 's'} to review`}
                  >
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-12">
            {auth.email ? (
              <span className="flex items-center gap-8 text-[14px] leading-[20px] text-faint">
                <span className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-brand text-[14px] font-bold leading-[20px] text-paper">
                  {initial}
                </span>
                <span className="hidden sm:inline">{auth.email}</span>
              </span>
            ) : null}
            <button
              type="button"
              onClick={auth.signOut}
              className="min-h-[44px] rounded-[8px] border border-edge-ctl px-12 text-[14px] font-bold text-brand transition-colors duration-150 hover:bg-surface"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-12 py-24 sm:px-16 md:px-24">
        <Outlet />
      </main>
    </div>
  );
}
