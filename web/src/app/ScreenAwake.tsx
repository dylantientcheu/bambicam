import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../ui/icons';

export function ScreenAwake({ active }: { active: boolean }) {
  const [state, setState] = useState<'pending' | 'held' | 'unavailable'>('pending');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let pending = false;
    let lock: WakeLockSentinel | undefined;
    async function acquire() {
      if (!alive || pending || (lock && !lock.released) || document.visibilityState !== 'visible')
        return;
      if (!navigator.wakeLock) {
        setState('unavailable');
        return;
      }
      pending = true;
      try {
        const result = await navigator.wakeLock.request('screen');
        if (!alive) {
          await result.release();
          return;
        }
        lock = result;
        setState(result.released ? 'unavailable' : 'held');
        result.addEventListener('release', () => {
          if (alive) setState('unavailable');
        });
      } catch {
        if (alive) setState('unavailable');
      } finally {
        pending = false;
      }
    }
    setState('pending');
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [active, attempt]);
  if (!active || state !== 'unavailable') return null;
  return (
    <details class="awake-note">
      <summary>
        <Icon name="moon" size={15} /> Screen may sleep
      </summary>
      <p>Keep this phone unlocked. Check Auto-Lock and Low Power Mode if the screen turns off.</p>
      {navigator.wakeLock && (
        <button class="text-button" onClick={() => setAttempt(attempt + 1)}>
          Try keeping screen awake
        </button>
      )}
    </details>
  );
}
