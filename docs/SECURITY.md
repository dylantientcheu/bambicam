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
Forgetting does not revoke a copied secret or a lost phone; rotate the code on
the baby to disconnect every holder of the old code. The QR stays hidden after
the first successful connection, including during outages, until **Show pairing
code** is selected. A full-room rejection produces an advisory notice on the baby
and a **New pairing code** action. A relay can forge or suppress this notice; it
does not establish the identity or intentions of the joining device.

There is no persistent parent-device identity or approval list. A fresh session
nonce also changes on an ordinary reconnect and is not a device identifier.
Ephemeral key agreement alone would not revoke a copied pairing secret: a holder
could still authenticate a new exchange. Device enrollment and revocation need a
separate protocol design; the current code does not claim forward secrecy for
recorded signaling after compromise of the pairing secret.

## Trust boundaries

- The web host can replace the JavaScript. A compromised host, publishing
  credential, dependency, browser extension, or device can defeat the protocol.
  A checksum served by the same compromised host is not an independent trust anchor.
- The relay and static host are separate services. A relay-only compromise does
  not by itself grant the ability to publish a new frontend. Shared administrator
  credentials still create a common trust boundary.
- HTTPS/WSS protects transport to the host. Keep registrar, GitHub, and hosting
  accounts secured, and protect the publishing workflow and recovery methods.
  CSP allows `ws:` for local HTTP hosting; HTTPS pages still require `wss:` in
  both the app's relay validation and the browser's mixed-content policy.
- STUN discovers addresses and sees network metadata, not media. TURN is not
  configured. Some networks cannot establish a direct connection.
- Incoming links that change the configured relay or introduce a different STUN
  server require approval before either is contacted. Previously remembered
  settings remain trusted; turning STUN off needs no approval.
- Pairing fragments may still exist in QR screenshots, clipboard/history sync,
  or browser extensions. The app removes the incoming fragment from its current
  history entry, but cannot erase copies outside the app.

## Availability

The relay bounds live connections (2,048), new upgrades (60/second globally),
rooms (1,000), join time (5 seconds), frame size (64 KiB), per-socket message rate
(100/second), and per-socket bytes (256 KiB/second). Each source is limited to 32
connections, 16 owned rooms, and 120 upgrade attempts/minute. IPv4-mapped addresses
are normalized and IPv6 sources share a /64 limit. Networks sharing a public IP
share these limits. Source counters live only in memory, are capped at 4,096
entries, and expire after their rate window once no connections or rooms remain.

Only exact configured browser origins may upgrade. Origin is a drive-by abuse
filter, not authentication: a non-browser client can forge it. By default source
limits use the TCP peer and ignore forwarded headers. `RELAY_TRUST_PROXY=true`
instead requires a single valid `X-Real-IP`; use it only behind a trusted proxy
that overwrites that header and cannot be bypassed. Never expose that listener
directly. See [deployment](DEPLOYMENT.md) and [self-hosting](SELF-HOSTING.md).

Lone room members expire after ten minutes even if they send pongs or signaling;
clients reconnect with backoff. A paired room is not expired. Sends are bounded
to 64 KiB per receiver (plus frame overhead) and 8 MiB of outstanding writes
across the process; a full queue terminates the affected receiver. These bounds
cover application send queues, not all TCP buffers or process memory. A heartbeat
cleans up dead peers. HTTP connections and shutdown are also bounded. Limits are
defined in `relay/server.mjs`; they reduce resource exhaustion, not distributed
denial of service. Edge rate limits, monitoring and resource limits remain necessary.

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
