# Security

Bambicam sends live audio and video directly between two browsers. The signaling
relay introduces them but does not receive their media or pairing secret.
This is an early implementation, not an independently audited security product.

## What the relay can do

The QR/link contains a random 256-bit secret in the URL fragment. Browsers do not
send that fragment in HTTP requests. HKDF derives a room ID and an AES-256-GCM
key. SDP (including the media certificate fingerprints) and ICE candidates are
encrypted and authenticated with that key. Fresh challenges and increasing
counters reject previous-session replay. Media uses WebRTC DTLS-SRTP.

A relay operator can observe IPs, room IDs, connection timing, message sizes,
sender role, random session identifiers, counters, and ciphertext. The envelope
header is authenticated but not encrypted. The operator can correlate peers,
drop messages, replay traffic, forge relay controls, or occupy room slots to
deny service. Without the secret, it cannot produce an authenticated SDP with
substituted media keys. This protection assumes the served app and devices are
unmodified and the implementation has no exploitable flaw.

The two-socket room limit is a capacity rule, not identity verification. Someone
with a photographed QR or copied pairing link can authenticate as a peer. Use
**New pairing code** if a code may have been exposed. An unused code rotates
after ten minutes; a paired code remains valid until the baby restarts or rotates
it. The parent can opt in to save it locally; **Forget baby unit** removes it.

## Trust boundaries

- The web host can replace the JavaScript. A compromised host, publishing
  credential, dependency, browser extension, or device can defeat the protocol.
  A checksum served by the same compromised host is not an independent trust anchor.
- The relay and static host are separate services. A relay-only compromise does
  not by itself grant the ability to publish a new frontend. Shared administrator
  credentials still create a common trust boundary.
- HTTPS/WSS protects transport to the host. Keep registrar, GitHub, and hosting
  accounts secured, and protect the publishing workflow and recovery methods.
- STUN discovers addresses and sees network metadata, not media. TURN is not
  configured. Some networks cannot establish a direct connection.
- Pairing fragments may still exist in QR screenshots, clipboard/history sync,
  or browser extensions. The app removes the incoming fragment from its current
  history entry, but cannot erase copies outside the app.

## Availability

The relay bounds live connections (2,048), new upgrades (60/second globally),
rooms (1,000), join time (5 seconds), frame size (64 KiB), per-socket message rate
(100/second), per-socket bytes (256 KiB/second), and receiver buffering. A heartbeat
cleans up dead peers. HTTP connections and shutdown are also bounded. Limits are
defined in `relay/server.mjs`; they reduce resource exhaustion, not distributed
denial of service. No IP-based counters or trust in forwarded-IP headers are used.

Run one relay instance. Rooms are in memory and are not shared across replicas.
Restarting it interrupts the current client media session, which then reconnects
with fresh challenges. Test deployment recovery and monitor hosting costs/uptime.
The web and relay health endpoints test each service separately, not an entire
two-device monitoring session.

Bambicam has no cry/motion alerts, recording, or guaranteed background playback.
The baby device must stay visible and unlocked. A displayed connection indicator
does not prove that the speaker is audible or that a device will stay awake.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/dylantientcheu/bambicam/security/advisories/new).
Include affected versions, reproduction steps, and a minimal demonstration using
synthetic media. Do not put live pairing secrets, private video, or exploit details
in a public issue. Supported fixes target the latest `main` revision.

See [PROTOCOL.md](PROTOCOL.md) for the wire format and [PRIVACY.md](PRIVACY.md)
for data handling.
