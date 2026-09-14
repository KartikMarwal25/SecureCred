import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Button } from './Button.jsx';

function extractCertificateNumber(decodedText) {
  if (!decodedText || !decodedText.includes('/verify/')) return null;
  const afterMarker = decodedText.split('/verify/')[1];
  if (!afterMarker) return null;
  return afterMarker.split(/[/?#]/)[0] || null;
}

/**
 * Camera permission is requested only when this component mounts (i.e. only
 * once the user has clicked "Scan the QR code"), never on page load. All
 * media tracks are stopped on close, unmount, and when the tab is hidden.
 */
export function QrScanner({ onDecode, onClose, onTypeInstead }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (width && height) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, width, height);
        if (code?.data) {
          const certificateNumber = extractCertificateNumber(code.data);
          if (certificateNumber) {
            stopStream();
            onDecode(certificateNumber);
            return;
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onDecode, stopStream]);

  const startStream = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setUnavailable(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setUnavailable(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setUnavailable(true);
    }
  }, [tick]);

  useEffect(() => {
    startStream();
    return () => stopStream();
    // Only ever runs once per mount of the scanner view; startStream/stopStream
    // are stable via useCallback.
  }, [startStream, stopStream]);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        stopStream();
      } else if (!unavailable) {
        startStream();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [stopStream, startStream, unavailable]);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  return (
    <div className="flex flex-col gap-16">
      {unavailable ? (
        <div className="rounded-[6px] border border-warn bg-warn-bg px-16 py-12 text-[14px] leading-[20px] text-warn">
          The camera is not available. Either permission was declined or this device has no camera.
        </div>
      ) : (
        <div className="relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-[6px] bg-ink">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div
            className="pointer-events-none absolute inset-24 rounded-[6px] border-2 border-dashed border-accent"
            aria-hidden="true"
          />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <div className="flex flex-wrap gap-8">
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
        <Button variant="secondary" onClick={onTypeInstead}>
          Type the identifier instead
        </Button>
      </div>
    </div>
  );
}
