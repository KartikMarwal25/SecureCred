import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicHeader } from '../../components/PublicHeader.jsx';
import { PublicFooter } from '../../components/PublicFooter.jsx';
import { Reveal } from '../../components/Reveal.jsx';
import { buttonClassName } from '../../components/Button.jsx';
import { getInstitutionShowcase } from '../../api/client.js';
import { ShieldIcon } from '../../components/icons/ShieldIcon.jsx';
import { CameraIcon } from '../../components/icons/CameraIcon.jsx';
import { BuildingIcon } from '../../components/icons/BuildingIcon.jsx';
import { LockIcon } from '../../components/icons/LockIcon.jsx';
import { NoLoginIcon } from '../../components/icons/NoLoginIcon.jsx';
import { LinkIcon } from '../../components/icons/LinkIcon.jsx';
import { CheckIcon } from '../../components/icons/CheckIcon.jsx';
import { ArrowRightIcon } from '../../components/icons/ArrowRightIcon.jsx';

const TRUST_ITEMS = [
  { icon: LinkIcon, label: 'Powered by Polygon' },
  { icon: LockIcon, label: 'SHA-256 secured' },
  { icon: NoLoginIcon, label: 'No login required to verify' },
];

const STEPS = [
  {
    number: '1',
    icon: ShieldIcon,
    title: 'Issue',
    body: 'Institutions create a certificate through their dashboard. It is fingerprinted with SHA-256 before anything leaves the server.',
  },
  {
    number: '2',
    icon: LinkIcon,
    title: 'Anchor',
    body: 'The fingerprint is pinned to IPFS and recorded on the Polygon blockchain — a permanent, timestamped proof that cannot be altered.',
  },
  {
    number: '3',
    icon: CheckIcon,
    title: 'Verify',
    body: 'Anyone scans a QR code or enters the certificate number. SecureCred checks the document against the blockchain record instantly.',
  },
];

export function LandingPage() {
  const [showcase, setShowcase] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getInstitutionShowcase()
      .then((data) => {
        if (!cancelled) setShowcase(data);
      })
      .catch(() => {
        // No live data to show — the card falls back to generic copy below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <PublicHeader showBack={false} />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- Hero */}
        <section
          className="relative overflow-hidden px-12 pb-48 pt-48 sm:px-16 sm:pb-64 sm:pt-64 md:px-24"
          style={{ backgroundImage: 'var(--gradient-hero)' }}
        >
          <div className="mx-auto flex max-w-[720px] flex-col items-center gap-24 text-center">
            <div className="animate-fade-in-up inline-flex items-center gap-8 rounded-full border border-edge bg-paper px-16 py-4 text-[14px] font-bold leading-[20px] text-ink shadow-xs">
              <span className="relative flex h-8 w-8">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex h-8 w-8 rounded-full bg-ok" />
              </span>
              Live on Polygon
            </div>

            <h1
              className="animate-fade-in-up text-[36px] font-bold leading-[44px] text-ink sm:text-[44px] sm:leading-[52px] md:text-[52px] md:leading-[60px]"
              style={{ animationDelay: '80ms' }}
            >
              Tamper-proof digital certificates,{' '}
              <span className="rounded-[8px] bg-accent/60 px-8 text-ink">verified instantly.</span>
            </h1>

            <p
              className="prose-copy animate-fade-in-up text-[16px] leading-[24px] text-muted sm:text-[18px] sm:leading-[28px]"
              style={{ animationDelay: '160ms' }}
            >
              Blockchain-anchored infrastructure for academic and professional credentials.
              Secure, permanent, and checkable by anyone — no account required.
            </p>

            <div
              className="animate-fade-in-up flex w-full flex-col gap-12 sm:w-auto sm:flex-row"
              style={{ animationDelay: '240ms' }}
            >
              <Link to="/verify" className={buttonClassName('primary', 'w-full sm:w-auto')}>
                <CameraIcon className="h-20 w-20" />
                Verify a certificate
              </Link>
              <Link to="/sign-in" className={buttonClassName('secondary', 'w-full sm:w-auto')}>
                <BuildingIcon className="h-20 w-20" />
                Institution sign in
              </Link>
            </div>

            {/* Floating example certificate card */}
            <div
              className="animate-fade-in-up animate-float mt-24 w-full max-w-[440px] rounded-[16px] border border-edge bg-paper p-24 text-left shadow-lg"
              style={{ animationDelay: '320ms' }}
            >
              <div className="flex items-center justify-between gap-12">
                <div className="flex items-center gap-12">
                  <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[8px] bg-brand text-paper">
                    <BuildingIcon className="h-20 w-20" />
                  </span>
                  <div>
                    <p className="text-[16px] font-bold leading-[24px] text-ink">
                      {showcase?.institutionName || 'Your institution, here'}
                    </p>
                    <p className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                      Registered issuer
                    </p>
                  </div>
                </div>
                {showcase?.institutionName ? (
                  <span className="inline-flex shrink-0 items-center gap-4 rounded-full bg-ok-bg px-12 py-4 text-[12px] font-bold uppercase tracking-[0.4px] text-ok">
                    <CheckIcon className="h-12 w-12" />
                    Verified
                  </span>
                ) : null}
              </div>
              <div className="mt-16 flex flex-col gap-8">
                <div className="h-8 w-full rounded-full bg-zebra" />
                <div className="h-8 w-2/3 rounded-full bg-zebra" />
              </div>
              <div className="mt-16 flex items-center justify-between border-t border-edge pt-16">
                <div>
                  <p className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                    Certificates issued
                  </p>
                  <p className="text-[14px] leading-[20px] text-body">
                    {showcase?.institutionName
                      ? `${showcase.certificateCount.toLocaleString()} on Polygon`
                      : 'Be the first registered issuer'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- Trust bar */}
        <section className="border-y border-edge bg-surface px-12 py-24 sm:px-16 md:px-24">
          <div className="mx-auto flex max-w-[1280px] flex-col flex-wrap items-center justify-center gap-16 sm:flex-row sm:gap-32">
            {TRUST_ITEMS.map((item) => (
              <div key={item.label} className="flex items-center gap-8 text-[14px] font-bold text-body">
                <item.icon className="h-20 w-20 text-brand" />
                {item.label}
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- Three steps */}
        <section className="px-12 py-48 sm:px-16 sm:py-64 md:px-24">
          <div className="mx-auto max-w-[1280px]">
            <Reveal className="text-center">
              <h2 className="text-[28px] font-bold leading-[36px] text-ink sm:text-[32px] sm:leading-[40px]">
                Three steps to permanence
              </h2>
              <p className="prose-copy mx-auto mt-8 text-[16px] leading-[24px] text-muted">
                The architecture of trust, simplified for everyday use.
              </p>
            </Reveal>

            <div className="stagger-children mt-32 grid grid-cols-1 gap-24 md:grid-cols-3">
              {STEPS.map((step) => (
                <Reveal
                  key={step.title}
                  className="group flex flex-col gap-16 rounded-[16px] border border-edge bg-paper p-24 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <span className="flex h-40 w-40 items-center justify-center rounded-[8px] bg-brand text-[16px] font-bold text-paper">
                    {step.number}
                  </span>
                  <h3 className="text-[20px] font-bold leading-[28px] text-ink">{step.title}</h3>
                  <p className="text-[16px] leading-[24px] text-muted">{step.body}</p>
                  <span className="mt-8 flex h-96 items-center justify-center rounded-[12px] bg-surface transition-transform duration-300 group-hover:scale-105">
                    <step.icon className="h-40 w-40 text-brand opacity-70" />
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- CTA */}
        <section className="px-12 pb-48 sm:px-16 md:px-24">
          <Reveal
            className="bg-grid-pattern relative mx-auto max-w-[1280px] overflow-hidden rounded-[24px] px-24 py-48 text-center sm:py-64"
            style={{ backgroundImage: 'var(--gradient-dark-panel)' }}
          >
            <div className="pointer-events-none absolute -right-32 -top-32 h-[200px] w-[200px] rounded-full bg-accent/20 blur-3xl animate-float" />
            <div className="pointer-events-none absolute -bottom-32 -left-32 h-[200px] w-[200px] rounded-full bg-brand/40 blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />
            <div className="relative mx-auto max-w-[640px]">
              <h2 className="text-[28px] font-bold leading-[36px] text-paper sm:text-[32px] sm:leading-[40px]">
                Ready to modernize your credentials?
              </h2>
              <p className="prose-copy mx-auto mt-12 text-[16px] leading-[24px] text-paper/80">
                Institutions issue permanent, independently verifiable certificates in minutes —
                no wallet, no gas fees, no blockchain expertise required.
              </p>
              <div className="mt-24 flex flex-col items-center gap-12 sm:flex-row sm:justify-center">
                <Link to="/sign-in" className={buttonClassName('accent', 'w-full sm:w-auto')}>
                  Get started as an institution
                  <ArrowRightIcon className="h-16 w-16" />
                </Link>
                <Link to="/about" className={buttonClassName('secondary', 'w-full border-white/30 bg-transparent text-paper hover:bg-white/10 sm:w-auto')}>
                  Learn how it works
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
