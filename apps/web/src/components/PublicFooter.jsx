import { Link } from 'react-router-dom';
import { Logo } from './Logo.jsx';

const COLUMNS = [
  {
    heading: 'Learner',
    links: [
      { to: '/verify', label: 'Verify a certificate' },
      { to: '/sign-in', label: 'Your credentials' },
    ],
  },
  {
    heading: 'Institution',
    links: [
      { to: '/sign-in', label: 'Issue a certificate' },
      { to: '/about', label: 'How it works' },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-edge bg-surface">
      <div className="mx-auto max-w-[1280px] px-12 py-32 sm:px-16 md:px-24">
        <div className="grid grid-cols-1 gap-32 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="prose-copy mt-12 text-[14px] leading-[20px] text-faint">
              Standardizing digital trust through decentralized verification. Built on
              Polygon.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                {column.heading}
              </p>
              <ul className="mt-12 flex flex-col gap-8">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-[14px] leading-[20px] text-muted hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-32 border-t border-edge pt-16 text-[12px] leading-[16px] text-faint">
          © {new Date().getFullYear()} SecureCred. SKIT/CSE/2023-2027/26.
        </div>
      </div>
    </footer>
  );
}
