import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { IconButton } from '../ui/IconButton';

export function AppMenu({
  children,
  onOpenChange,
}: {
  children: (close: () => void) => ComponentChildren;
  onOpenChange: (open: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  return (
    <>
      <IconButton
        icon="more"
        label="Options"
        onClick={() => {
          dialog.current?.showModal();
          onOpenChange(true);
        }}
      />
      <dialog
        ref={dialog}
        class="options-sheet"
        aria-labelledby="options-title"
        onClose={() => onOpenChange(false)}
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
      >
        <div class="sheet-content">
          <div class="sheet-heading">
            <h2 id="options-title">Options</h2>
            <IconButton icon="close" label="Close options" onClick={close} />
          </div>
          {children(close)}
        </div>
      </dialog>
    </>
  );
}
