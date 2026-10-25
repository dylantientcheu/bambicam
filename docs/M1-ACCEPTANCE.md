# M1 physical-device acceptance

M0 and M1 acceptance are complete, confirmed by the maintainer on 2026-10-26.
The physical same-Wi-Fi and overnight acceptance boxes in PLAN.md are checked.
The steps below remain the regression checklist for new devices and deployments;
browser simulation alone does not establish physical-device behavior.

Automated result, 2026-10-25: `npm run check` passes (TypeScript, 10 crypto/relay
tests, production build). All 32 Playwright tests pass against the production
preview at `http://localhost:4173`, including repeated reconnects, offline
recovery, occupied rooms, remembered pairing, night mode, audio levels,
compact controls, and portrait/landscape layouts. Installation checks confirm
no new offline cache and migration of old workers without losing saved pairings
or interrupting live video. QR scans and pairing
links connect directly. iPhone full-view/PiP regressions check both advertised
fullscreen APIs, repeated transitions, and immediate scroll/focus cleanup.
These use Chromium and synthetic media, with simulated Safari presentation
methods where relevant. Physical acceptance is recorded separately above.

Record device models, OS/browser versions, app origin, network setup, start/end
times, and any interruption. Use a stable HTTPS origin or keep the development
computer, preview, relay, and temporary tunnel running throughout the test.

1. **Pair on Wi-Fi.** Open the same URL on both devices. Start baby capture,
   scan from the parent and confirm the feed connects without an extra Connect tap.
   Repeat using the system camera's QR link. Confirm changing video and audible sound.
   Make a sound, then remain quiet: verify the sound-level icon responds. Tap Play or
   Enable sound meter if Safari requests it.
2. **Night mode.** Wait 15 seconds after connection; the baby screen should dim.
   Sound/video must continue. Tap to show controls, then use Dim screen again.
   Check whether wake lock is held; if unavailable, set Auto-Lock appropriately.
3. **Viewing.** On iPhone Safari and Chrome, repeat Expand view → Exit full view →
   PiP → Bring video back three times. Options and Stop must remain tappable, and
   live sound/video must continue. Also enter PiP directly from the expanded view.
   Try phone rotation and confirm the whole frame remains visible. Repeat separately from the installed
   Home Screen app; document unsupported PiP rather than treating it as success.
4. **Reconnect.** Briefly turn Wi-Fi off and on on each device, one at a time.
   Reconnecting must be visible, stale remote media must clear when the old
   connection closes, and video/audio must resume without a new scan. Keep both
   apps open. Stop the parent and reconnect; the baby capture should continue.
5. **Interruptions and freezes.** Call the baby phone, answer, then hang up.
   The baby unit must show "Camera paused by the system" during the call and
   return to live without a rescan; the parent must receive moving video again.
   Cover the baby camera with a hand: the picture goes dark but is not flagged.
   Then force a freeze (switch the baby to another app for 10 seconds on
   Android): the parent must show "Video may be frozen" with elapsed time while the accessible status
   still says Connected, and clear when frames return. Inspect the selected media
   path in Options → Advanced; a local connection may also use a STUN candidate.
6. **Remember and forget.** Opt in on the parent, reload, and use Connect to baby
   without rescanning. Forget, reload, and verify no pairing is offered. Verify
   a baby restart/new code invalidates the old pairing.
7. **Different networks.** With the public HTTPS tunnel/relay and STUN enabled,
   leave baby on Wi-Fi and switch parent to cellular. Confirm whether that
   network permits direct media; inspect the selected media path in Options →
   Advanced. A failure must explain direct-network limits;
   there is no TURN fallback. Repeat with STUN blank on both to check LAN only.
8. **Overnight.** Connect power, keep the baby app visible/unlocked, keep the
   parent visible, and leave the session for at least eight hours. Check live
   motion and audible sound at the end, not just the Connected label. Note any
   user action required, OS interruption, heat, or wake-lock loss.
9. **Cleanup and update.** Stop both roles and confirm capture indicators go
   away. Deploy a new build while monitoring; video and sound must continue without
   a forced reload or update prompt. After stopping, reopen or refresh online to
   load the new build. On a previously installed version, verify legacy offline
   caches are retired without losing a remembered pairing. No offline launch is promised.

Repeat the physical run for a new hosting setup before marking its hosted
acceptance complete. Locked-screen monitoring and background capture are not promised.
