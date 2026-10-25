export interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pending: InstallPrompt | null = null;

// Listen before the component mounts: an eligible browser may emit this event
// between the initial render and a deferred effect.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pending = event as InstallPrompt;
});
window.addEventListener('appinstalled', () => {
  pending = null;
});

export function takeInstallPrompt() {
  const prompt = pending;
  pending = null;
  return prompt;
}
