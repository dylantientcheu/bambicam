import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../ui/IconButton';
import { Icon } from '../ui/icons';

export function NightMode({ connected }: { connected: boolean }) {
  const [dimmed, setDimmed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!connected) setDimmed(false);
  }, [connected]);
  useEffect(() => {
    if (dimmed && connected) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      button.current?.focus();
    }
  }, [dimmed, connected]);
  return (
    <>
      <IconButton
        icon="moon"
        label="Dim screen"
        buttonRef={button}
        disabled={!connected}
        onClick={() => setDimmed(true)}
      />
      <dialog
        class="night-mode"
        ref={dialog}
        aria-label="Night mode"
        onCancel={() => setDimmed(false)}
      >
        <button onClick={() => setDimmed(false)} autoFocus aria-label="Show controls">
          <Icon name="sleep" size={72} />
          <span>Tap to show controls</span>
        </button>
      </dialog>
    </>
  );
}
