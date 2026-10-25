import { useEffect, useRef, useState } from 'preact/hooks';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
};

export function Scanner({
  onScan,
  onCancel,
}: {
  onScan: (value: string) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        const NativeDetector = (window as Window & { BarcodeDetector?: DetectorClass })
          .BarcodeDetector;
        let detector: Detector | undefined;
        try {
          if (NativeDetector && (await NativeDetector.getSupportedFormats()).includes('qr_code'))
            detector = new NativeDetector({ formats: ['qr_code'] });
        } catch {
          /* Use the local fallback. */
        }
        let jsQR = detector ? undefined : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        async function scan() {
          if (!active || !video.current) return;
          const element = video.current;
          try {
            let result: string | undefined;
            if (element.readyState >= 2 && element.videoWidth) {
              if (detector) {
                try {
                  result = (await detector.detect(element))[0]?.rawValue;
                } catch {
                  detector = undefined;
                  jsQR = (await import('jsqr')).default;
                }
              } else if (jsQR) {
                canvas.width = Math.min(640, element.videoWidth);
                canvas.height = Math.round(
                  (element.videoHeight * canvas.width) / element.videoWidth,
                );
                context.drawImage(element, 0, 0, canvas.width, canvas.height);
                const frame = context.getImageData(0, 0, canvas.width, canvas.height);
                result = jsQR(frame.data, frame.width, frame.height, {
                  inversionAttempts: 'dontInvert',
                })?.data;
              }
            }
            if (result && active) {
              active = false;
              stream?.getTracks().forEach((track) => track.stop());
              onScan(result);
              return;
            }
          } catch {
            /* A camera can briefly have no frame during rotation. */
          }
          if (active) timer = setTimeout(() => void scan(), 200);
        }
        await scan();
      } catch {
        if (active)
          setError(
            'Camera unavailable. Allow camera access, or open the code with your phone’s camera app. You can also paste a pairing link below.',
          );
      }
    }
    void start();
    return () => {
      active = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <div class="scanner">
      <video ref={video} autoPlay muted playsInline aria-label="QR code scanner" />
      <p>Point your camera at the code on the baby unit.</p>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <button class="text-button" onClick={onCancel}>
        Close scanner
      </button>
    </div>
  );
}
