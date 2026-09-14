import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ROLE } from '@securecred/shared';
import { Logo } from './Logo.jsx';
import { BackButton } from './BackButton.jsx';
import { buttonClassName } from './Button.jsx';
import { useAuth } from '../auth/useAuth.js';

const NAV_LINKS = [{ to: '/about', label: 'How it works' }];

const DASHBOARD_BY_ROLE = { [ROLE.INSTITUTION]: '/app/registry', [ROLE.STUDENT]: '/me' };

/**
 * Shared header for every public page (landing, verify, about, sign-in).
 * Shows Sign in/Sign up only while signed out; once signed in it shows a
 * link to the person's own dashboard and a sign-out control instead — this
 * header is also rendered on /verify and /about, which stay reachable
 * either way, so it can't just disappear for a signed-in visitor.
 * A small hamburger menu appears below the `md` breakpoint.
 */
export function PublicHeader({ showBack = true }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const auth = useAuth();
  const showAuthedState = auth.isLoaded && auth.isSignedIn;
  const dashboardHref = DASHBOARD_BY_ROLE[auth.role] ?? '/choose-role';

  return (
    <header className="border-b border-edge bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-16 px-12 py-12 sm:px-16 md:px-24">
        <div className="flex min-w-0 items-center gap-16">
          {showBack ? <BackButton label="" className="!gap-0 shrink-0" /> : null}
          <Link to="/" className="shrink-0">
            <Logo />
          </Link>
        </div>

        <nav className="hidden items-center gap-24 md:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `text-[16px] leading-[24px] transition-colors ${isActive ? 'font-bold text-ink' : 'text-muted hover:text-ink'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-8 md:flex">
          <Link to="/verify" className={buttonClassName('secondary')}>
            Verify a certificate
          </Link>
          {showAuthedState ? (
            <>
              <Link to={dashboardHref} className={buttonClassName('primary')}>
                Go to your dashboard
              </Link>
              <button
                type="button"
                onClick={() => auth.signOut()}
                className="min-h-[44px] rounded-[8px] px-12 text-[16px] font-bold leading-[24px] text-brand hover:bg-surface"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/sign-up"
                className="text-[16px] font-bold leading-[24px] text-brand hover:underline"
              >
                Sign up
              </Link>
              <Link to="/sign-in" className={buttonClassName('primary')}>
                Sign in
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-edge-ctl text-ink md:hidden"
        >
          <span className="relative block h-16 w-20">
            <span
              className={`absolute left-0 top-0 h-2 w-20 rounded-full bg-current transition-transform duration-200 ${menuOpen ? 'translate-y-7 rotate-45' : ''}`}
            />
            <span
              className={`absolute left-0 top-7 h-2 w-20 rounded-full bg-current transition-opacity duration-200 ${menuOpen ? 'opacity-0' : ''}`}
            />
            <span
              className={`absolute left-0 top-14 h-2 w-20 rounded-full bg-current transition-transform duration-200 ${menuOpen ? '-translate-y-7 -rotate-45' : ''}`}
            />
          </span>
        </button>
      </div>

      {menuOpen ? (
        <nav
          className="flex flex-col gap-4 border-t border-edge px-12 py-12 animate-fade-in-up sm:px-16 md:hidden"
          aria-label="Main"
        >
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className="min-h-[44px] rounded-[8px] px-12 py-8 text-[16px] font-bold leading-[24px] text-ink hover:bg-surface"
            >
              {link.label}
            </NavLink>
          ))}
          <Link
            to="/verify"
            onClick={() => setMenuOpen(false)}
            className={buttonClassName('secondary', 'w-full justify-start mt-4')}
          >
            Verify a certificate
          </Link>
          {showAuthedState ? (
            <>
              <Link
                to={dashboardHref}
                onClick={() => setMenuOpen(false)}
                className={buttonClassName('primary', 'w-full justify-start')}
              >
                Go to your dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  auth.signOut();
                }}
                className="min-h-[44px] rounded-[8px] px-12 text-left text-[16px] font-bold leading-[24px] text-brand hover:bg-surface"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/sign-up"
                onClick={() => setMenuOpen(false)}
                className={buttonClassName('secondary', 'w-full justify-start')}
              >
                Sign up
              </Link>
              <Link
                to="/sign-in"
                onClick={() => setMenuOpen(false)}
                className={buttonClassName('primary', 'w-full justify-start')}
              >
                Sign in
              </Link>
            </>
          )}
        </nav>
      ) : null}
    </header>
  );
}
