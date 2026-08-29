import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth.js';

const NAV_ITEMS = [
  { to: '/app/registry', label: 'Certificates' },
  { to: '/app/issue', label: 'Issue credential' },
  { to: '/app/activity', label: 'Activity' },
];

export function InstitutionLayout() {
  const auth = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-edge px-12 py-16 sm:px-16 md:px-24">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-16 md:flex-row md:items-center md:justify-between">
          <p className="text-[18px] font-bold leading-[26px] text-ink">SecureCred</p>
          <nav className="flex flex-wrap gap-8" aria-label="Institution navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center rounded-[4px] px-12 text-[16px] font-bold leading-[24px] ${
                    isActive ? 'bg-brand text-paper' : 'text-brand hover:bg-surface'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-12">
            {auth.email ? (
              <span className="text-[14px] leading-[20px] text-faint">{auth.email}</span>
            ) : null}
            <button
              type="button"
              onClick={auth.signOut}
              className="min-h-[44px] rounded-[4px] border border-edge-ctl px-12 text-[14px] font-bold text-brand hover:bg-surface"
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
