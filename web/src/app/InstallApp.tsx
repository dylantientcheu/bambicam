import { useEffect, useState } from 'preact/hooks';
import { takeInstallPrompt } from './installPrompt';
import { Icon } from '../ui/icons';

export function InstallApp() {
  const [installed, setInstalled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => {
    const display = matchMedia('(display-mode: standalone)');
    const update = () =>
      setInstalled(
        display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
      );
    const complete = () => {
      setInstalled(true);
      setExpanded(false);
    };
    update();
    display.addEventListener('change', update);
    window.addEventListener('appinstalled', complete);
    return () => {
      display.removeEventListener('change', update);
      window.removeEventListener('appinstalled', complete);
    };
  }, []);
  async function install() {
    const prompt = takeInstallPrompt();
    if (!prompt) {
      setExpanded(!expanded);
      return;
    }
    try {
      await prompt.prompt();
    } catch {
      setError('Use your browser’s menu to install bambicam.');
      setExpanded(true);
    }
  }
  if (installed) return null;
  return (
    <div>
      <button class="menu-row" aria-expanded={expanded} onClick={install}>
        <Icon name="download" size={20} /> Add to Home Screen
      </button>
      {expanded && (
        <div class="menu-content" aria-label="Installation instructions">
          {error && <p role="alert">{error}</p>}
          {ios ? (
            <p>
              In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Keep{' '}
              <strong>Open as Web App</strong> on if offered.
            </p>
          ) : (
            <p>
              Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong> in your
              browser’s menu.
            </p>
          )}
          <p>Pair again inside the installed app. It still needs a live connection.</p>
          {ios && <p>Picture in Picture may work in Safari but not in the Home Screen app.</p>}
          {location.hostname.endsWith('.trycloudflare.com') && (
            <p>This test address stops working when the tunnel closes.</p>
          )}
        </div>
      )}
    </div>
  );
}
