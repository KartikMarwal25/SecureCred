import { Link } from 'react-router-dom';

const STEPS = [
  {
    title: 'Issue',
    body: 'An institution issues a credential through SecureCred, describing the holder, the award, and the date.',
  },
  {
    title: 'Anchor',
    body: 'SecureCred stores the document and records a reference to it on the blockchain, so it cannot be altered afterwards without detection.',
  },
  {
    title: 'Verify',
    body: 'Anyone holding the certificate identifier or QR code can check, at any time, whether the document is genuine and still valid.',
  },
];

export function AboutPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col gap-32 px-12 py-32 sm:px-16 md:px-24">
      <h1 className="text-[24px] font-bold leading-[32px] text-ink">About SecureCred</h1>

      <section>
        <h2 className="text-[18px] font-bold leading-[26px] text-ink">Issue · Anchor · Verify</h2>
        <ol className="mt-16 flex flex-col gap-16">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <p className="text-[16px] font-bold leading-[24px] text-ink">
                {index + 1}. {step.title}
              </p>
              <p className="prose-copy mt-4 text-[16px] leading-[24px] text-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="prose-copy text-[16px] leading-[24px] text-body">
        A single wallet, held and operated by SecureCred on the institution&rsquo;s behalf, signs
        every blockchain transaction the system makes. No student or verifier ever needs their own
        wallet, and no one is ever asked to pay a gas fee.
      </p>

      <p className="text-[16px] leading-[24px]">
        <Link to="/verify" className="font-bold text-brand">
          Back to verification
        </Link>
      </p>
    </main>
  );
}
