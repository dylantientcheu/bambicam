# Pairing and signaling (M1)

This describes the implemented version 1 format. It is an initial protocol,
not an independently audited security design.

## Pairing

The baby generates 32 cryptographically random bytes. Encode as unpadded,
canonical base64url. The pairing URL uses the same origin and pathname as the
app and has `#p=<secret>&r=<encoded relay URL>&s=<encoded STUN URL>`. All
values are fragment-only. An empty `s` selects LAN only; legacy links without
`s` use the default STUN endpoint. Only STUN URLs are accepted, never TURN.
The parent reads the fragment into memory and immediately removes it with
`history.replaceState`. In-app scanning rejects links for a different origin
or pathname. A valid pairing connects immediately; the relay is available in
Options → Advanced.

Use HKDF-SHA-256 with the decoded secret as input keying material and an empty
salt. UTF-8 `info` labels are:

- `bambicam/room`: 16 output bytes, lowercase hex room ID.
- `bambicam/signal`: 32 output bytes, a nonextractable AES-256-GCM key.

All-zero input keying material gives room ID
`1c0f58ce513752a9a55d20eb2a344e27` (a test vector only, never a real pairing).

## Relay transport

Connect to the configured WebSocket endpoint. The first frame is text JSON:
`{"join":"<32 lowercase hex characters>"}`. At most two sockets join a room.
The server responds with `{"type":"joined"}`. When there are two sockets, it
sends `{"type":"peer-joined"}` to both. On departure it sends
`{"type":"peer-left"}` to the remaining peer. These controls are untrusted;
they do not authenticate the other device. A socket can join only once.

Subsequent client frames are binary, at most 65,536 bytes. They are forwarded
unchanged, never echoed to the sender or stored for delivery to a later joiner.
Text frames after joining are rejected. Empty rooms are removed immediately
on socket close; dead connections are detected by the relay heartbeat.

## Encrypted envelope

Each peer arrival has a fresh random 16-byte session nonce and a send counter
starting at 1, including when the local relay socket survives a remote reconnect. Byte offsets:

| Offset | Length    | Value                                             |
| ------ | --------- | ------------------------------------------------- |
| 0      | 1         | Version: `1`                                      |
| 1      | 1         | Sender role: `0` baby, `1` parent                 |
| 2      | 16        | Random sender session nonce                       |
| 18     | 4         | Unsigned big-endian send counter                  |
| 22     | 12        | Fresh random AES-GCM IV                           |
| 34     | remainder | Ciphertext followed by 16-byte authentication tag |

The first 22 bytes are AES-GCM additional authenticated data. Encrypt UTF-8
JSON with the derived signaling key, a fresh 96-bit IV for every message, and
a 128-bit tag. Never wrap a counter or reuse a channel object for a new peer arrival.
Outbound and inbound operations are serialized; WebSocket preserves ordering.

Receivers accept only the opposite role and increasing counters. They pin the
peer session after authenticating its first hello. Invalid authentication,
direction, session, shape, or counter fails the session closed. Packet loss,
reordering, forged relay controls, and replay can deny service; availability
against a malicious relay is not a guarantee.

## Freshness handshake

Both peers send encrypted `{"type":"hello"}` when the relay reports a peer.
Each replies with encrypted `{"type":"ready","echo":"<peer session nonce>"}`;
the echoed nonce is unpadded base64url. A ready message is accepted only after
hello, with the pinned peer session and the receiver's own fresh nonce echoed.
No SDP/ICE is accepted before ready. A recorded hello can elicit a response,
but a recorded ready will not echo a new session's nonce, so it cannot authorize
an old SDP offer. The role byte prevents reflecting a device's own messages.

After ready, the baby sends `{"type":"offer","sdp":"..."}` and the parent
replies with `{"type":"answer","sdp":"..."}`. Both send ICE as
`{"type":"ice","candidate":<RTCIceCandidate.toJSON()>}`. Received candidates
are queued until the remote description has been applied. There is a single
offer/answer exchange per peer connection. Reconnection creates a fresh peer
connection and secure channel on both sides. Media uses WebRTC's DTLS-SRTP encryption; the encrypted,
authenticated SDP binds its fingerprints to the shared pairing secret.

## Lifecycle and limits

The baby rotates an unused secret after ten minutes, or on **New pairing code**.
After a successful media connection, automatic rotation is disabled for that
secret, including during outages. Rotation closes the old peer and socket before
joining the new room. Baby secrets remain in memory only.

Relay loss retries with exponential backoff (1–15 seconds, plus up to 500 ms of
jitter). A full room retries too, allowing the server heartbeat to clear a stale
socket. A peer departure closes only the media connection and secure channel;
the surviving relay socket waits for another arrival. A disconnected media path
gets eight seconds to recover; failed ICE or a 25-second handshake timeout closes
the local socket and retries. The surviving device sees peer-left and discards
its channel, so the next peer-joined starts fresh on both sides. Async work from
closed peers/sockets is ignored. Authentication or protocol errors fail closed
instead of automatically trusting a new session. Relay controls can still deny
service, as stated above.

The parent can explicitly store `{version:1, secret, relay, stun}` under
`bambicam.remembered.v1` in localStorage. Loading validates the entry and offers a
connect button, not an automatic media session. Forget removes that key and
stops the current parent. The app registers no service worker and keeps no offline
app cache. Legacy-worker cleanup removes only this app scope's worker and shell
caches, preserving remembered pairings. Stop cancels retries and
closes the remote tracks; stopping baby capture also stops the local tracks.

Knowing a room ID lets an attacker occupy a slot or deny service. Knowing the
QR secret lets a device authenticate as a peer. A two-socket cap is a limit,
not proof that a joining device is the intended parent. The web host, browser,
operating system, and physical devices are trusted. STUN defaults to
`stun:stun.cloudflare.com:3478`, can be changed or disabled, and sees IP
addresses/discovery traffic but no media. TURN is not used.
