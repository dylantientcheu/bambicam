import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';

export function PairingCode({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc('');
    setError('');
    setCopied(false);
    void QRCode.toDataURL(url, {
      width: 320,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#292236', light: '#ffffff' },
    })
      .then((value) => {
        if (active) setSrc(value);
      })
      .catch(() => {
        if (active) setError('Could not draw the code. Copy the pairing link instead.');
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Clipboard unavailable. Use the code, or select the pairing link below.');
    }
  }
  return (
    <>
      <div class="qr-frame">
        {src ? (
          <img
            src={src}
            width="280"
            height="280"
            alt="Scan this pairing code on the parent device"
          />
        ) : (
          <p>Preparing your code…</p>
        )}
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <button class="text-button" onClick={copy}>
        {copied ? 'Pairing link copied' : 'Copy pairing link'}
      </button>
      {error && (
        <label class="field">
          Pairing link
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </>
  );
}
