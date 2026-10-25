# Bambicam roadmap

A privacy-first baby monitor using two devices you already own. Live media travels
between the devices over WebRTC. The hosted services deliver the app and forward
encrypted signaling; they do not record or receive media.

M0 and M1 are complete, including physical acceptance confirmed by the maintainer
on 2026-10-26. M2 is in progress. Last updated 2026-10-26.

## Principles

- No accounts, recordings, analytics, or runtime third-party scripts.
- Authenticated, encrypted signaling; direct encrypted media; no TURN in v1.
- Explicit opt-in for remembered pairing, with a clear Forget control.
- Configurable relay and STUN; self-hosting supported.
- Small, auditable code and honest limits. The web host and devices remain trusted.

The baby unit must remain visible and unlocked. Parent background/locked-screen
playback depends on the browser and OS and is not guaranteed. No cry/motion alerts
are implemented in M2.

## Architecture

```text
Baby browser ── encrypted signaling ── Relay ── encrypted signaling ── Parent browser
      └──────────────── direct WebRTC audio/video ────────────────────┘
```

The static Preact/Vite app and Node WebSocket relay are separate Railway services.
The relay keeps temporary room state in one process, with no database or volume.
One replica is required. A frontend-only deployment does not restart signaling;
a relay restart interrupts viewing while the clients reconnect.

Self-hosting uses two containers managed by one Compose file: Caddy serves static
files and proxies the same-origin relay endpoint. This replaces the initial
single-container proposal so each process has a clear lifecycle.

Details: [protocol](docs/PROTOCOL.md), [security](docs/SECURITY.md),
[privacy](docs/PRIVACY.md), [deployment](docs/DEPLOYMENT.md),
[self-hosting](docs/SELF-HOSTING.md).

## Milestones

**M0 — it works in one room**
- [x] Scaffold web + relay with workspaces.
- [x] Relay: join, cap at two, forward, cleanup.
- [x] Pairing: secret, HKDF, QR display and scan.
- [x] Encrypted signaling envelope, with fresh session challenges and replay checks.
- [x] WebRTC video + audio, baby to parent, same WiFi implementation.
- [x] Acceptance: two physical phones on the same WiFi stream video and audio after one scan.

Run instructions and the trusted HTTPS setup are in README.md. The implemented
wire format is in docs/PROTOCOL.md. Automated checks cover crypto, relay behavior,
and browser pairing with synthetic video/audio, including QR fallback scanning.
Selected M1 features below were subsequently requested and implemented.

**M1 — it is a baby monitor**
- [x] Night mode and compact live sound meter, with accessible connection status.
- [x] Screen wake lock, with visibility recovery and honest unavailable state.
- [x] Parent fullscreen / expanded view, whole-frame video, and capability-checked PiP.
- [x] Automatic reconnect on both sides, with fresh challenges, backoff, and cleanup.
- [x] "Remember this baby unit" and "forget" (explicit opt-in, parent only).
- [x] Configurable STUN for cross-network use, LAN-only option, and clear failure message.
- [x] PWA manifest, install prompt / iPhone instructions, no offline cache, legacy-worker cleanup.
- [x] iPhone foreground and Home Screen PiP limitations surfaced in the UI.
- [x] Acceptance: a parent can leave it running overnight without touching it.

Trust polish, added before M2 shipping:
- [x] Frozen-video detection on the parent: "No new video for Ns" and a warning
      when frames stop while the connection still reports live.
- [x] Connection path shown on both devices from ICE stats: direct on the local
      network, or direct across networks via STUN.
- [x] Baby capture interruption handling: a system pause (call, background) is
      shown, an ended camera is reacquired once the app is in front, and the
      tracks are swapped into the live connection without a rescan.

M0/M1 acceptance is complete. Keep [the device checklist](docs/M1-ACCEPTANCE.md)
for regression testing; repeat it on the final hosted deployment.

**M2 — people can use it**

- [x] Choose `bambi.cam` as the primary domain; registered by the maintainer.
- [x] Choose MIT and include third-party runtime license notices.
- [x] Add relay and static web Dockerfiles, pinned base images, and build allowlists.
- [x] Bound relay connections, upgrade bursts, byte rate, and shutdown; test recovery.
- [x] Add production security/cache headers and fix the privacy-policy link.
- [x] Add security, privacy, deployment, contribution, and self-hosting documentation.
- [x] Record completed M0/M1 acceptance consistently.
- [x] Create Railway project and separate web/relay services, one replica each.
- [x] Verify both deployed services with public HTTPS and WebSocket smoke checks.
- [ ] Complete custom-domain DNS and certificate activation.
- [ ] Publish the cleaned repository and pass CI on the public revision.
- [x] Add screenshots using synthetic media only.
- [ ] Verify the Compose path on a clean checkout and both supported CPU architectures.
- [ ] Validate the private Tailscale recipe on real devices.
- [ ] Record hosted restart recovery, resource use, and an eight-hour device run.
- [ ] Set operational uptime/billing alerts and finish the stranger installation test.

Done when a stranger can pair through the hosted app and self-host from the README
in ten minutes after the documented Docker/DNS or Tailscale prerequisites are ready.
A successful local M1 run does not substitute for acceptance of the new hosted path.

**M3 — alerts**

- Sound-level threshold and basic frame-difference motion detection on the baby unit.
- Typed events over the data channel; no frames uploaded.
- Parent vibration, sound, and browser notifications where supported.
- Define supported foreground/background behavior per platform before promising alerts.

**M4 — computer vision on device**

- Explore on-device pose/face inference and confidence-labelled events.
- No frames sent to hosted services; define accuracy and limitations before release.

**Later**

- Push-to-talk; multiple parents with approval; optional user-operated TURN.
- Optional local recording, native parent background audio, or app-store wrappers.

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-10-25 | Preact + Vite, browser APIs, Web/PWA first | Small shared codebase for both device roles |
| 2026-10-25 | QR fragment secret, HKDF, AES-GCM signaling | Pairing secret stays out of HTTP requests |
| 2026-10-25 | LAN + configurable STUN, no TURN | No media server; some networks remain unsupported |
| 2026-10-25 | No caching service worker | Optional installation without a stale offline shell |
| 2026-10-26 | MIT, bambi.cam, separate Railway services | Public release with simple operations and independent frontend releases |
| 2026-10-26 | Two containers in Compose | Separate Caddy/Node process lifecycles and persistent TLS storage |
