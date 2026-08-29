/** Always present, on every outcome panel, never collapsible, exact wording. */
export function ProofDisclaimer() {
  return (
    <div className="rounded-[6px] border border-edge bg-surface p-16">
      <p className="prose-copy text-[16px] leading-[24px] text-body">
        <span className="font-bold">What this proves — and what it does not.</span> SecureCred
        confirms that this file is byte-identical to the document the institution issued, and
        that the institution is a registered issuer. It does not assess the academic merit
        behind the credential, and it does not check that the institution itself is accredited.
      </p>
    </div>
  );
}
