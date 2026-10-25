import type { RefObject } from 'preact';
import { Icon, type IconName } from './icons';

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  expand,
  buttonRef,
}: {
  icon: IconName;
  label: string;
  onClick: () => void | Promise<void>;
  pressed?: boolean;
  disabled?: boolean;
  expand?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      class="icon-button"
      ref={buttonRef}
      type="button"
      aria-label={label}
      data-tooltip={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-expand={expand || undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}
