import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PublicHeader } from '../../components/PublicHeader.jsx';
import { PublicFooter } from '../../components/PublicFooter.jsx';
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
  const [activeTab, setActiveTab] = useState(HAS_CAMERA_API ? 'scan' : 'enter');
  const inputRef = useRef(null);

  const openScanner = useCallback(() => {
    setSearchParams({ scan: '1' });
  }, [setSearchParams]);

  const closeScanner = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const focusManualField = useCallback(() => {
    setSearchParams({}, { replace: true });
    setActiveTab('enter');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setSearchParams]);

  const selectTab = useCallback(
    (tab) => {
      if (tab === activeTab) return;
      if (isScanning) closeScanner();
      setActiveTab(tab);
      if (tab === 'enter') {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [activeTab, isScanning, closeScanner],
  );

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

  useEffect(() => {
    if (isScanning) setActiveTab('scan');
  }, [isScanning]);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <PublicHeader />

      <main
        className="flex-1 px-12 py-32 sm:px-16 sm:py-48 md:px-24"
        style={{ backgroundImage: 'var(--gradient-hero)' }}
      >
        <div className="animate-fade-in-up mx-auto flex max-w-[560px] flex-col gap-24">
          <div className="text-center">
            <h1 className="text-[28px] font-bold leading-[36px] text-ink sm:text-[32px] sm:leading-[40px]">
              Verify a certificate
            </h1>
            <p className="mt-8 text-[16px] leading-[24px] text-muted">
              Check whether an academic document is genuine.
            </p>
          </div>

          <div className="rounded-[16px] border border-edge bg-paper p-24 shadow-sm">
            <div className="flex border-b border-edge" role="tablist" aria-label="Verification method">
              {HAS_CAMERA_API ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'scan'}
                  onClick={() => selectTab('scan')}
                  className={`min-h-[44px] flex-1 border-b-2 px-12 text-[16px] font-bold leading-[24px] transition-colors duration-200 ${
                    activeTab === 'scan'
                      ? 'border-brand text-ink'
                      : 'border-transparent text-muted hover:text-ink'
                  }`}
                >
                  Scan QR
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'enter'}
                onClick={() => selectTab('enter')}
                className={`min-h-[44px] flex-1 border-b-2 px-12 text-[16px] font-bold leading-[24px] transition-colors duration-200 ${
                  activeTab === 'enter'
                    ? 'border-brand text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                Enter ID
              </button>
            </div>

            <div className="animate-fade-in mt-24">
              {activeTab === 'scan' ? (
                isScanning ? (
                  <QrScanner
                    onDecode={handleDecode}
                    onClose={closeScanner}
                    onTypeInstead={focusManualField}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-16 py-16 text-center">
                    <span className="flex h-64 w-64 items-center justify-center rounded-full bg-surface text-brand">
                      <CameraIcon className="h-28 w-28" />
                    </span>
                    <p className="prose-copy text-[14px] leading-[20px] text-faint">
                      Point your camera at the QR code printed on the document.
                    </p>
                    <Button variant="primary" className="w-full sm:w-auto" onClick={openScanner}>
                      <CameraIcon className="h-20 w-20" />
                      Scan the QR code
                    </Button>
                  </div>
                )
              ) : (
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
                  <p className="text-[14px] leading-[20px] text-faint">
                    Printed at the foot of the document.
                  </p>
                  <Button type="submit" variant="primary" className="mt-8">
                    Verify
                  </Button>
                </form>
              )}
            </div>
          </div>

          <p className="prose-copy text-center text-[14px] leading-[20px] text-faint">
            You do not need an account. Verifications are counted for the issuing institution, but
            they are not linked to you.
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
