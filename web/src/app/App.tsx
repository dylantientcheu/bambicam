import { useEffect, useRef, useState } from 'preact/hooks';
import { PairingCode } from '../baby/PairingCode';
import { Scanner } from '../parent/Scanner';
import { connectMonitor, type MonitorHandle, type Stage } from '../rtc/monitor';
import type { Path } from '../rtc/peer';
import { pathLabel } from '../ui/path';
import {
  delay,
  isTransient,
  startCapture,
  watchCapture,
  whenVisible,
  type CaptureState,
} from '../baby/capture';
import {
  defaultRelay,
  newSecret,
  needsServerApproval,
  pairingUrl,
  parsePairing,
  validateRelay,
} from '../signal/pairing';
import type { Role } from '../signal/crypto';
import { Brand, Icon } from '../ui/icons';
import { Video } from '../ui/Video';
import { ParentViewer } from '../parent/ParentViewer';
import { InstallApp } from './InstallApp';
import { ScreenAwake } from './ScreenAwake';
import { retireOfflineCache } from './retireOfflineCache';
import { DEFAULT_STUN, validateStun } from '../rtc/ice';
import { forgetRemembered, loadRemembered, saveRemembered } from './remembered';
import { NightMode } from '../baby/NightMode';
import { AppMenu } from './AppMenu';
import { IconButton } from '../ui/IconButton';

const pageUrl = location.origin + location.pathname;
const initial = (() => {
  const value = location.href;
  if (!location.hash) return {};
  history.replaceState(null, '', location.pathname + location.search); // Keep secrets out of history and later copies.
  try {
    return { pairing: parsePairing(value, pageUrl) };
  } catch (error) {
    return { error: (error as Error).message };
  }
})();
const rememberedOnOpen = loadRemembered(pageUrl);
const initialPairing = initial.pairing ?? (initial.error ? null : rememberedOnOpen);
const trustedServers = rememberedOnOpen ?? {
  relay: import.meta.env.VITE_RELAY_URL ?? defaultRelay(pageUrl),
  stun: import.meta.env.VITE_STUN_URL ?? DEFAULT_STUN,
};
const initialPending = initial.pairing && needsServerApproval(initial.pairing, trustedServers)
  ? initial.pairing : null;
const labels: Record<Stage, string> = {
  connecting: 'Connecting to relay',
  waiting: 'Waiting for the other device',
  pairing: 'Connecting securely',
  live: 'Connected',
  reconnecting: 'Reconnecting',
  ended: 'Disconnected',
};

export function App() {
  const secure =
    window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!crypto.subtle;
  const [role, setRole] = useState<Role | null>(initialPairing || initial.error ? 'parent' : null);
  const [relay, setRelay] = useState(
    initialPending ? trustedServers.relay : initialPairing?.relay ?? trustedServers.relay,
  );
  const [stun, setStun] = useState(
    initialPending ? trustedServers.stun : initialPairing?.stun ?? trustedServers.stun,
  );
  const [secret, setSecret] = useState(initialPairing?.secret ?? '');
  const [saved, setSaved] = useState(rememberedOnOpen);
  const [remember, setRemember] = useState(
    !!initialPairing && initialPairing.secret === rememberedOnOpen?.secret,
  );
  const [storageError, setStorageError] = useState('');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [running, setRunning] = useState(!!initial.pairing && !initialPending && secure);
  const [pendingPairing, setPendingPairing] = useState(initialPending);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('connecting');
  const [path, setPath] = useState<Path | null>(null);
  const [capture, setCapture] = useState<CaptureState>('live');
  const [error, setError] = useState(initial.error ?? '');
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState('');
  const [generation, setGeneration] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [showCode, setShowCode] = useState(true);
  const [joinRejected, setJoinRejected] = useState(false);
  const captureRequest = useRef(0);
  const connectedOnce = useRef(false);
  const localRef = useRef<MediaStream | null>(null);
  const monitor = useRef<MonitorHandle | null>(null);

  useEffect(() => {
    void retireOfflineCache();
  }, []);

  useEffect(() => {
    // A pairing link opened in an existing tab can be a fragment-only navigation.
    function openedPairing() {
      if (!location.hash) return;
      const value = location.href;
      history.replaceState(null, '', location.pathname + location.search);
      reset();
      setRole('parent');
      readCode(value);
    }
    window.addEventListener('hashchange', openedPairing);
    return () => window.removeEventListener('hashchange', openedPairing);
  }, [saved, local, relay, stun]);

  useEffect(() => {
    if (!local) return;
    const unwatch = watchCapture(local, {
      onState: setCapture,
      onEnded: () => void recoverCapture(local),
    });
    return () => {
      unwatch();
      for (const track of local.getTracks()) track.stop();
    };
  }, [local]);
  useEffect(() => {
    if (!running || !role || !secret) return;
    let active = true;
    connectedOnce.current = false;
    setShowCode(true);
    setJoinRejected(false);
    setError('');
    setStage('connecting');
    setRemote(null);
    setPath(null);
    void connectMonitor({
      role,
      secret,
      relay,
      stun,
      stream: localRef.current ?? undefined,
      onStage: (value) => {
        if (active) {
          if (value === 'live') {
            connectedOnce.current = true;
            setShowCode(false);
          }
          setStage(value);
        }
      },
      onStream: (stream) => {
        if (active) setRemote(stream);
      },
      onPath: (value) => {
        if (active) setPath(value);
      },
      onError: (message) => {
        if (active) setError(message);
      },
      onJoinRejected: () => {
        if (active && role === 'baby') setJoinRejected(true);
      },
    })
      .then((handle) => {
        if (active) monitor.current = handle;
        else handle.close();
      })
      .catch(() => {
        if (active) {
          setError(
            'Could not start a secure connection. Use a current browser over HTTPS and try again.',
          );
          setStage('ended');
        }
      });
    // Only successful media connection stops expiry; an untrusted relay join does not.
    const expiry =
      role === 'baby'
        ? setTimeout(
            () => {
              if (active && !connectedOnce.current) setSecret(newSecret());
            },
            10 * 60 * 1000,
          )
        : undefined;
    return () => {
      active = false;
      monitor.current?.close();
      monitor.current = null;
      clearTimeout(expiry);
    };
  }, [running, role, secret, relay, stun, generation]);

  function reset() {
    captureRequest.current++;
    setRunning(false);
    setBusy(false);
    setRole(null);
    setSecret('');
    setError('');
    setScanning(false);
    local?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    setLocal(null);
    setRemote(null);
    setPath(null);
    setCapture('live');
    setLink('');
    setRemember(false);
    setStorageError('');
    setPendingPairing(null);
  }
  async function startBaby() {
    const request = ++captureRequest.current;
    setError('');
    setBusy(true);
    try {
      setRelay(validateRelay(relay, pageUrl));
      setStun(validateStun(stun));
      const stream = await startCapture();
      if (request !== captureRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localRef.current = stream;
      setLocal(stream);
      setCapture('live');
      setSecret(newSecret());
      setRunning(true);
    } catch (err) {
      if (request !== captureRequest.current) return;
      setError(
        err instanceof DOMException
          ? 'Camera or microphone unavailable. Allow both permissions and close any other app using the camera, then try again.'
          : (err as Error).message,
      );
    } finally {
      if (request === captureRequest.current) setBusy(false);
    }
  }
  // A phone call or the system can end capture while monitoring. Reacquire the
  // same devices once the app is in front again and swap the tracks in place,
  // so the parent keeps its connection without scanning again.
  async function recoverCapture(old: MediaStream) {
    const request = ++captureRequest.current;
    old.getTracks().forEach((track) => track.stop());
    setCapture('recovering');
    setError('');
    for (let attempt = 0; ; attempt++) {
      await whenVisible();
      if (request !== captureRequest.current) return;
      try {
        const stream = await startCapture(old);
        if (request !== captureRequest.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localRef.current = stream;
        setLocal(stream);
        setCapture('live');
        monitor.current?.replaceStream(stream);
        return;
      } catch (err) {
        if (request !== captureRequest.current) return;
        if (attempt >= 3 || !isTransient(err)) break;
        await delay(1_000 * 2 ** attempt);
      }
    }
    if (request !== captureRequest.current) return;
    setCapture('live');
    setRunning(false);
    localRef.current = null;
    setLocal(null);
    setError(
      'The camera or microphone stopped and could not be restarted. Check this device, close other apps using the camera, and start capture again.',
    );
  }
  function readCode(value: string) {
    setScanning(false);
    setError('');
    try {
      const pairing = parsePairing(value.trim(), pageUrl);
      setLink('');
      setRole('parent');
      if (needsServerApproval(pairing, { relay, stun })) {
        setRunning(false);
        setPendingPairing(pairing);
      } else acceptPairing(pairing);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function acceptPairing(pairing: NonNullable<typeof initial.pairing>) {
    setPendingPairing(null);
    setSecret(pairing.secret);
    setRelay(pairing.relay);
    setStun(pairing.stun);
    setRemember(pairing.secret === saved?.secret);
    setRunning(secure);
    // Reopening the same code must also rebuild the session reset by hashchange.
    setGeneration((value) => value + 1);
  }
  function startParent() {
    try {
      const relayUrl = validateRelay(relay, pageUrl);
      const stunUrl = validateStun(stun);
      setRelay(relayUrl);
      setStun(stunUrl);
      if (remember) persistPairing(relayUrl, stunUrl);
      setRunning(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function persistPairing(relayUrl = relay, stunUrl = stun) {
    try {
      const pairing = { secret, relay: relayUrl, stun: stunUrl };
      saveRemembered(pairing);
      setSaved(pairing);
      setRemember(true);
      setStorageError('');
    } catch {
      setRemember(false);
      setStorageError(
        'This browser could not save the pairing. You can still connect; keep the pairing link for next time.',
      );
    }
  }
  function forget() {
    try {
      forgetRemembered();
      setSaved(null);
      reset();
    } catch {
      setStorageError(
        'This browser could not remove the saved pairing. Clear this site’s data in browser settings.',
      );
    }
  }
  function useSaved() {
    if (!saved) return;
    setRole('parent');
    setSecret(saved.secret);
    setRelay(saved.relay);
    setStun(saved.stun);
    setRemember(true);
    setError('');
  }
  function retry() {
    setError('');
    setRemote(null);
    setGeneration((value) => value + 1);
    if (role === 'baby') setSecret(newSecret());
  }

  const watching = running && role === 'parent';
  const paired = stage === 'live';
  const settings = (
    <details class="menu-section">
      <summary>
        <Icon name="settings" size={20} /> Advanced
      </summary>
      <div class="menu-content">
        {path && pathLabel[path] && <p class="path-note">{pathLabel[path]}</p>}
        <fieldset disabled={running || busy || scanning}>
          <label class="field">
            Relay address
            <input
              type="url"
              value={relay}
              onInput={(event) => setRelay(event.currentTarget.value)}
              spellcheck={false}
              autoComplete="off"
            />
          </label>
          <p>Connects your devices using encrypted messages. Video and sound travel directly.</p>
          <label class="field">
            STUN server (optional)
            <input
              type="text"
              value={stun}
              onInput={(event) => setStun(event.currentTarget.value)}
              spellcheck={false}
              autoComplete="off"
              placeholder="Blank for the same Wi-Fi only"
            />
          </label>
          <p>
            Helps across networks. Its operator sees your IP, never media. Leave blank for LAN only.
          </p>
        </fieldset>
        {running && <p>Stop monitoring to change these settings.</p>}
      </div>
    </details>
  );

  return (
    <div class={`shell ${watching ? 'is-watching' : ''} ${running ? 'is-monitoring' : ''}`}>
      <header class="app-header">
        <Brand />
        <div class="header-actions">
          {role && (
            <IconButton
              icon={running ? 'close' : 'back'}
              label={running ? 'Stop & go back' : 'Choose a different role'}
              onClick={reset}
            />
          )}
          <AppMenu onOpenChange={setOptionsOpen}>
            {(close) => (
              <>
                {role === 'baby' && running && (
                  <button
                    class="menu-row"
                    onClick={() => {
                      setShowCode((value) => !value);
                      close();
                    }}
                  >
                    <Icon name="scan" size={20} /> {showCode ? 'Hide pairing code' : 'Show pairing code'}
                  </button>
                )}
                {role === 'baby' && running && (
                  <button
                    class="menu-row"
                    onClick={() => {
                      retry();
                      close();
                    }}
                  >
                    <Icon name="scan" size={20} /> New pairing code
                  </button>
                )}
                {role === 'parent' && running && saved?.secret !== secret && (
                  <button
                    class="menu-row"
                    onClick={() => {
                      persistPairing();
                      close();
                    }}
                  >
                    <Icon name="bookmark" size={20} /> Remember this baby unit
                  </button>
                )}
                {saved && role !== 'baby' && (
                  <button
                    class="menu-row"
                    onClick={() => {
                      forget();
                      close();
                    }}
                  >
                    <Icon name="forget" size={20} /> Forget baby unit
                  </button>
                )}
                <InstallApp />
                <details class="menu-section">
                  <summary>
                    <Icon name="help" size={20} /> Using bambicam
                  </summary>
                  <div class="menu-content">
                    <p>
                      Keep the baby phone open and unlocked. Use Dim screen to darken its display;
                      tap to show the controls again.
                    </p>
                    <p>
                      On the parent, turn your phone for landscape. Turn off Portrait Orientation
                      Lock on iPhone if needed.
                    </p>
                    <p>
                      PiP depends on your browser. Try Safari if it is unavailable in the Home
                      Screen app. Locking the phone can interrupt playback.
                    </p>
                    <p>
                      Same Wi-Fi is most reliable. Some mobile and guest networks block direct
                      connections.
                    </p>
                    <p>
                      Remembering a camera saves its private pairing key on this phone until you
                      forget it. Forgetting does not revoke copied links or a lost phone.
                      Use New pairing code on the baby phone to revoke the old code.
                    </p>
                  </div>
                </details>
                {settings}
              </>
            )}
          </AppMenu>
        </div>
      </header>
      <main>
        {running && (
          <span class="sr-only" role="status">
            {labels[stage]}
          </span>
        )}
        {storageError && (
          <p class="error" role="alert">
            {storageError}
          </p>
        )}
        {!secure && (
          <p class="error" role="alert">
            Open the trusted HTTPS address on both phones to use the camera.
          </p>
        )}
        {error && !watching && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {!role ? (
          <div class="welcome">
            <div class="intro">
              <h1>A little closer.<br />Even from the next room.</h1>
              <p>Choose what this device will do.</p>
            </div>
            <div class="role-picker">
              <button
                class="role-choice baby-choice"
                onClick={() => {
                  setRole('baby');
                  setError('');
                }}
              >
                <span class="role-icon">
                  <Icon name="baby" size={34} />
                </span>
                <span class="role-copy">
                  <strong>Baby unit</strong>
                  <span>Set up the camera</span>
                </span>
                <Icon name="arrow-up-right" size={20} />
              </button>
              <button
                class="role-choice parent-choice"
                onClick={() => {
                  if (saved) useSaved();
                  else {
                    setRole('parent');
                    setError('');
                  }
                }}
              >
                <span class="role-icon">
                  <Icon name="parent" size={34} />
                </span>
                <span class="role-copy">
                  <strong>Parent unit</strong>
                  <span>{saved ? 'Watch baby' : 'Connect to baby'}</span>
                </span>
                <Icon name="arrow-up-right" size={20} />
              </button>
            </div>
            <p class="privacy-note">
              <a
                href="https://github.com/dylantientcheu/bambicam/blob/main/docs/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="lock" size={15} /> Privacy first.
              </a>
              <a
                href="https://github.com/dylantientcheu/bambicam"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source on GitHub <Icon name="arrow-up-right" size={15} />
              </a>
            </p>
          </div>
        ) : role === 'baby' ? (
          running ? (
            <>
              {joinRejected && (
                <div class="notice" role="alert">
                  <p>
                    The relay reported another device trying to join. If this wasn’t you,
                    create a new pairing code and scan it with your parent phone.
                  </p>
                  <button class="text-button" onClick={retry}>New pairing code</button>
                  <button class="text-button" onClick={() => setJoinRejected(false)}>Dismiss</button>
                </div>
              )}
              {capture !== 'live' && (
                <p class="notice" data-capture={capture}>
                  {capture === 'paused'
                    ? 'Camera paused by the system. Bring this app to the front.'
                    : 'Restarting camera and microphone…'}
                </p>
              )}
              <div class={`monitor-layout ${!showCode ? 'is-paired' : ''}`}>
                <div class="baby-picture">
                  <Video stream={local} local />
                  {paired && (
                    <div class="baby-tools">
                      <NightMode connected={paired && capture === 'live' && !optionsOpen && !showCode && !joinRejected} />
                    </div>
                  )}
                </div>
                {showCode && (
                  <aside class="pairing-panel">
                    <h1>Pair your phones.</h1>
                    <p>Scan with your other phone.</p>
                    <PairingCode url={pairingUrl(secret, relay, pageUrl, stun)} />
                    <p>Anyone with this code can connect. Only share it with your parent device.</p>
                  </aside>
                )}
              </div>
              <ScreenAwake active={stage !== 'ended'} />
            </>
          ) : (
            <div class="setup-panel">
              <span class="setup-illustration">
                <Icon name="baby" size={58} />
              </span>
              <h1>Baby camera</h1>
              <p>Leave this phone with your little one.</p>
              <button class="button" disabled={!secure || busy} onClick={startBaby}>
                {busy ? 'Allow camera & microphone…' : 'Start camera & microphone'}
              </button>
            </div>
          )
        ) : pendingPairing ? (
          <div class="setup-panel">
            <h1>This code uses different servers.</h1>
            <p>
              Their operators can see your IP address and connection timing. Continue only if
              these match the settings on your baby phone.
            </p>
            <p>Relay: {pendingPairing.relay}</p>
            <p>STUN: {pendingPairing.stun || 'Off'}</p>
            <button class="button" disabled={!secure} onClick={() => acceptPairing(pendingPairing)}>
              Use these servers
            </button>
            <button class="text-button" onClick={reset}>Cancel</button>
          </div>
        ) : running ? (
          <>
            <ParentViewer
              stream={stage === 'ended' ? null : remote}
              status={labels[stage]}
              live={paired}
              notice={error}
            />
            <ScreenAwake active={stage !== 'ended'} />
            {stage === 'ended' && (
              <button class="button secondary retry-button" onClick={retry}>
                Try connecting again
              </button>
            )}
          </>
        ) : (
          <div class="setup-panel parent-setup">
            {secret ? (
              <>
                <span class="setup-illustration">
                  <Icon name="parent" size={58} />
                </span>
                <h1>Baby camera</h1>
                {saved?.secret !== secret && (
                  <label class="remember-choice">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.currentTarget.checked)}
                    />{' '}
                    Remember this baby unit
                  </label>
                )}
                <button class="button" disabled={!secure} onClick={startParent}>
                  Connect to baby
                </button>
                <button class="text-button" onClick={() => setSecret('')}>
                  Use a different code
                </button>
              </>
            ) : (
              <>
                <span class="setup-illustration">
                  <Icon name="scan" size={54} />
                </span>
                <h1>Find your baby camera.</h1>
                <p>Scan the code on the baby phone.</p>
                {scanning ? (
                  <Scanner onScan={readCode} onCancel={() => setScanning(false)} />
                ) : (
                  <button class="button" disabled={!secure} onClick={() => setScanning(true)}>
                    <Icon name="scan" size={20} /> Scan pairing code
                  </button>
                )}
                <details class="paste-link">
                  <summary>Have a pairing link?</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      readCode(link);
                    }}
                  >
                    <label class="field">
                      Pairing link
                      <input
                        type="text"
                        value={link}
                        onInput={(event) => setLink(event.currentTarget.value)}
                        autoComplete="off"
                        spellcheck={false}
                        placeholder="Paste the link"
                      />
                    </label>
                    <button class="button secondary" disabled={!link.trim()}>
                      Use pairing link
                    </button>
                  </form>
                </details>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
