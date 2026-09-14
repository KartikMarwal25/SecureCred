import { Link } from 'react-router-dom';
import { PublicHeader } from '../../components/PublicHeader.jsx';
import { PublicFooter } from '../../components/PublicFooter.jsx';
import { Reveal } from '../../components/Reveal.jsx';
import { buttonClassName } from '../../components/Button.jsx';
import { ShieldIcon } from '../../components/icons/ShieldIcon.jsx';
import { LinkIcon } from '../../components/icons/LinkIcon.jsx';
import { CheckIcon } from '../../components/icons/CheckIcon.jsx';

const STEPS = [
  {
    icon: ShieldIcon,
    title: 'Issue',
    body: 'An institution issues a credential through SecureCred, describing the holder, the award, and the date.',
  },
  {
    icon: LinkIcon,
    title: 'Anchor',
    body: 'SecureCred stores the document and records a reference to it on the blockchain, so it cannot be altered afterwards without detection.',
  },
  {
    icon: CheckIcon,
    title: 'Verify',
    body: 'Anyone holding the certificate identifier or QR code can check, at any time, whether the document is genuine and still valid.',
  },
];

export function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <PublicHeader />

      <main className="flex-1">
        <section
          className="px-12 py-48 sm:px-16 sm:py-64 md:px-24"
          style={{ backgroundImage: 'var(--gradient-hero)' }}
        >
          <Reveal className="mx-auto max-w-[720px] text-center">
            <h1 className="text-[32px] font-bold leading-[40px] text-ink sm:text-[40px] sm:leading-[48px]">
              About SecureCred
            </h1>
            <p className="prose-copy mx-auto mt-12 text-[16px] leading-[24px] text-muted sm:text-[18px] sm:leading-[28px]">
              How permanent, independently verifiable credentials work under the hood.
            </p>
          </Reveal>
        </section>

        <section className="px-12 py-48 sm:px-16 md:px-24">
          <div className="mx-auto max-w-[880px]">
            <Reveal className="text-center">
              <h2 className="text-[24px] font-bold leading-[32px] text-ink">
                Issue · Anchor · Verify
              </h2>
            </Reveal>
            <div className="stagger-children mt-32 grid grid-cols-1 gap-24 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal
                  key={step.title}
                  className="flex flex-col gap-12 rounded-[16px] border border-edge bg-paper p-24 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <span className="flex h-40 w-40 items-center justify-center rounded-[8px] bg-brand text-paper">
                    <step.icon className="h-20 w-20" />
                  </span>
                  <h3 className="text-[18px] font-bold leading-[26px] text-ink">
                    {index + 1}. {step.title}
                  </h3>
                  <p className="text-[16px] leading-[24px] text-muted">{step.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="px-12 pb-48 sm:px-16 md:px-24">
          <Reveal className="prose-copy mx-auto max-w-[720px] rounded-[16px] border border-edge bg-surface p-24 text-[16px] leading-[24px] text-body shadow-xs">
            A single wallet, held and operated by SecureCred on the institution&rsquo;s behalf,
            signs every blockchain transaction the system makes. No student or verifier ever needs
            their own wallet, and no one is ever asked to pay a gas fee.
          </Reveal>

          <p className="mt-24 text-center text-[16px] leading-[24px]">
            <Link to="/verify" className={buttonClassName('secondary')}>
              Back to verification
            </Link>
          </p>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
