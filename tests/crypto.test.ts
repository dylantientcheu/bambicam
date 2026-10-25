import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecureChannel } from '../web/src/signal/crypto';
import { DEFAULT_STUN, iceServers, validateStun } from '../web/src/rtc/ice';
import {
  defaultRelay,
  derivePairing,
  fromBase64Url,
  newSecret,
  pairingUrl,
  parsePairing,
  validateRelay,
} from '../web/src/signal/pairing';

async function pair() {
  const { key } = await derivePairing(newSecret());
  const baby = new SecureChannel(key, 'baby');
  const parent = new SecureChannel(key, 'parent');
  const babyHello = await baby.seal({ type: 'hello' });
  const parentHello = await parent.seal({ type: 'hello' });
  await parent.open(babyHello);
  await baby.open(parentHello);
  const babyReady = await baby.seal({ type: 'ready', echo: parent.session });
  await parent.open(babyReady);
  await baby.open(await parent.seal({ type: 'ready', echo: baby.session }));
  return { key, baby, parent, babyHello, babyReady };
}

test('HKDF produces a deterministic room, distinct labels, and a nonextractable key', async () => {
  const secret = newSecret();
  assert.equal(fromBase64Url(secret, 32).length, 32);
  const first = await derivePairing(secret);
  const second = await derivePairing(secret);
  assert.match(first.roomId, /^[a-f0-9]{32}$/);
  assert.equal(first.roomId, second.roomId);
  assert.notEqual(first.roomId, (await derivePairing(newSecret())).roomId);
  await assert.rejects(crypto.subtle.exportKey('raw', first.key));
  // Stable vector makes accidental protocol changes visible.
  assert.equal(
    (await derivePairing('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).roomId,
    '1c0f58ce513752a9a55d20eb2a344e27',
  );
});

test('authenticated peers exchange offers and ICE without revealing their contents', async () => {
  const { baby, parent } = await pair();
  const signal = {
    type: 'offer' as const,
    sdp: 'v=0\r\na=fingerprint:sha-256 TEST-PRIVATE-SDP',
  };
  const packet = await baby.seal(signal);
  assert.ok(!new TextDecoder().decode(packet).includes('TEST-PRIVATE-SDP'));
  assert.deepEqual((await parent.open(packet)).signal, signal);
  assert.deepEqual(
    (
      await baby.open(
        await parent.seal({
          type: 'ice',
          candidate: { candidate: 'candidate:example', sdpMid: '0' },
        }),
      )
    ).signal,
    { type: 'ice', candidate: { candidate: 'candidate:example', sdpMid: '0' } },
  );
});

test('rejects replay, reflected packets, wrong secrets, modified headers and ciphertext', async () => {
  const { baby, parent, babyHello } = await pair();
  const packet = await baby.seal({ type: 'offer', sdp: 'private' });
  await parent.open(packet);
  await assert.rejects(parent.open(packet), /Replayed/);
  await assert.rejects(baby.open(packet), /sender/);
  const wrong = new SecureChannel((await derivePairing(newSecret())).key, 'parent');
  await assert.rejects(wrong.open(babyHello));
  for (const offset of [18, 25, 40]) {
    const tampered = new Uint8Array(await baby.seal({ type: 'offer', sdp: 'private' }));
    tampered[offset] ^= 1;
    await assert.rejects(parent.open(tampered.buffer));
  }
  assert.equal(
    (await parent.open(await baby.seal({ type: 'answer', sdp: 'valid' }))).signal.type,
    'answer',
  );
});

test('fresh session rejects a recorded handshake even when the pairing secret is reused', async () => {
  const { key, babyHello, babyReady } = await pair();
  const newParent = new SecureChannel(key, 'parent');
  await newParent.open(babyHello);
  await assert.rejects(newParent.open(babyReady), /challenge/);
});

test('SDP is rejected until a fresh challenge has been answered', async () => {
  const { key } = await derivePairing(newSecret());
  const baby = new SecureChannel(key, 'baby');
  const parent = new SecureChannel(key, 'parent');
  await parent.open(await baby.seal({ type: 'hello' }));
  await assert.rejects(
    parent.open(await baby.seal({ type: 'offer', sdp: 'old offer' })),
    /challenge/,
  );
});

test('pairing keeps the secret in the fragment, includes a custom relay, and rejects unsafe input', () => {
  const page = 'https://monitor.example/bambicam/';
  const secret = newSecret();
  const url = pairingUrl(secret, 'wss://relay.example/relay', page + '?tracking=gone#old');
  assert.equal(new URL(url).search, '');
  assert.ok(!url.split('#')[0].includes(secret));
  assert.deepEqual(parsePairing(url, page), {
    secret,
    relay: 'wss://relay.example/relay',
    stun: DEFAULT_STUN,
  });
  assert.equal(defaultRelay(page), 'wss://monitor.example/relay');
  assert.throws(
    () => parsePairing(url.replace('monitor.example', 'phishing.example'), page),
    /same address/,
  );
  assert.throws(() => parsePairing(url.replace(secret, 'bad'), page), /not valid/);
  assert.throws(() => validateRelay('ws://relay.example/relay', page), /secure/);
  assert.throws(
    () => validateRelay('wss://user:password@relay.example/relay', page),
    /credentials/,
  );
  assert.throws(() => validateRelay('javascript:alert(1)', page));
});

test('STUN settings survive pairing, LAN-only stays off, and media relays are rejected', () => {
  const page = 'https://monitor.example/';
  const secret = newSecret();
  assert.equal(parsePairing(pairingUrl(secret, defaultRelay(page), page, ''), page).stun, '');
  assert.deepEqual(iceServers(''), []);
  assert.deepEqual(iceServers(DEFAULT_STUN), [{ urls: DEFAULT_STUN }]);
  assert.equal(validateStun(' stun:stun.example:3478 '), 'stun:stun.example:3478');
  assert.equal(validateStun('stun:[::1]:3478'), 'stun:[::1]:3478');
  for (const invalid of [
    'turn:relay.example',
    'https://stun.example',
    'stun:user:pass@host',
    'stun:host:0',
    'stun:host:99999',
    'stun:host?transport=tcp',
  ])
    assert.throws(() => validateStun(invalid), /STUN address/);
});
