import { useCallback, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button.jsx';
import { QrScanner } from '../../components/QrScanner.jsx';
import { CameraIcon } from '../../components/icons/CameraIcon.jsx';

const HAS_CAMERA_API =
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

export function VerifyEntryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isScanning = searchParams.get('scan') === '1';
  const [identifier, setIdentifier] = useState('');
  const inputRef = useRef(null);

  const openScanner = useCallback(() => {
    setSearchParams({ scan: '1' });
  }, [setSearchParams]);

  const closeScanner = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const focusManualField = useCallback(() => {
    setSearchParams({}, { replace: true });
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setSearchParams]);

  const handleDecode = useCallback(
    (certificateNumber) => {
      navigate(`/verify/${encodeURIComponent(certificateNumber)}`);
    },
    [navigate],
  );

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const trimmed = identifier.trim();
      if (!trimmed) return;
      navigate(`/verify/${encodeURIComponent(trimmed)}`);
    },
    [identifier, navigate],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col gap-24 px-12 py-32 sm:px-16 md:px-24">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">SecureCred</h1>
        <p className="mt-8 text-[16px] leading-[24px] text-muted">
          Check whether an academic document is genuine.
        </p>
      </div>

      {isScanning ? (
        <QrScanner onDecode={handleDecode} onClose={closeScanner} onTypeInstead={focusManualField} />
      ) : (
        <div className="flex flex-col gap-24">
          {HAS_CAMERA_API ? (
            <Button variant="primary" className="w-full" onClick={openScanner}>
              <CameraIcon className="h-20 w-20" />
              Scan the QR code
            </Button>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            <label
              htmlFor="certificate-identifier"
              className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
            >
              Certificate identifier
            </label>
            <input
              id="certificate-identifier"
              ref={inputRef}
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="SKIT-2027-K7Q4M2XB"
              className="min-h-[44px] rounded-[4px] border border-edge-ctl bg-paper px-12 py-8 font-mono text-[15px] leading-[22px] text-body placeholder:text-faint"
            />
            <p className="text-[14px] leading-[20px] text-faint">Printed at the foot of the document.</p>
            <Button type="submit" variant="primary" className="mt-8">
              Verify
            </Button>
          </form>

          <p className="prose-copy text-[14px] leading-[20px] text-faint">
            You do not need an account. Verifications are counted for the issuing institution,
            but they are not linked to you.
          </p>
        </div>
      )}
    </main>
  );
}
