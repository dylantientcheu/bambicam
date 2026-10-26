# Device checks

M0/M1 acceptance was confirmed by the maintainer on 2026-10-26. Repeat these
checks for new devices and hosting setups. Automated browser tests use synthetic
media and do not establish physical-device or overnight reliability.

Record device/browser versions, app URL, networks, duration, and interruptions.
Use a stable HTTPS origin and keep both devices powered.

1. **Pair:** scan in-app and with the system camera. Confirm moving video,
   audible sound, and sound-meter response.
2. **View:** check rotation, fullscreen/expanded view, and supported PiP. Repeat
   from the Home Screen app; record unsupported features honestly.
3. **Night mode:** let the baby screen dim; confirm capture continues and
   tapping restores controls. Check the wake-lock status.
4. **Reconnect:** toggle Wi-Fi on each device separately. Verify a visible
   interruption and recovery without rescanning or stale media appearing live.
5. **Interrupt capture:** take a call or background the baby app. Confirm the
   interruption/freeze warning and moving video after returning to the app.
6. **Remember/forget:** opt in, reload, reconnect, then forget and reload again.
   A new baby pairing code must invalidate the old one.
7. **Networks:** try Wi-Fi to cellular with STUN, and LAN with STUN blank. Record
   unsupported routes; there is no TURN fallback.
8. **Overnight:** keep the baby visible/unlocked and parent visible for eight
   hours. Confirm motion and sound at the end; record heat, interruptions, or
   required user action.
9. **Stop/update:** verify capture indicators stop. Check planned deployment
   recovery, then refresh to load the new app. Confirm remembered pairing survives.

Locked-screen monitoring and background baby capture are not promised.
