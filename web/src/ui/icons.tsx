export type IconName =
  | 'baby'
  | 'parent'
  | 'lock'
  | 'back'
  | 'scan'
  | 'arrow-up-right'
  | 'more'
  | 'close'
  | 'expand'
  | 'collapse'
  | 'pip'
  | 'moon'
  | 'download'
  | 'help'
  | 'settings'
  | 'forget'
  | 'bookmark'
  | 'sleep'
  | 'sound'
  | 'sound-off';

export function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  const paths = {
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    collapse: <path d="M3 9h6V3m6 0v6h6M9 21v-6H3m18 0h-6v6" />,
    pip: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <rect x="11" y="11" width="8" height="6" rx="1" />
      </>
    ),
    moon: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.4 10.2Z" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01" />
      </>
    ),
    settings: <path d="M4 7h16M4 17h16M8 4v6m8 4v6" />,
    forget: (
      <>
        <path d="M5 7h14m-12 0 1 14h8l1-14M9 7V3h6v4m-5 4v6m4-6v6" />
      </>
    ),
    bookmark: <path d="M6 3h12v18l-6-4-6 4Z" />,
    sleep: <path d="M2 10q4 6 8 0m4 0q4 6 8 0" />,
    sound: <path d="M4 10v4h4l5 4V6l-5 4H4m12-2a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
    'sound-off': <path d="M4 10v4h4l5 4V6l-5 4H4m13-1 5 6m0-6-5 6" />,
    baby: (
      <>
        <path d="M8 9V5a4 4 0 0 1 8 0v4M5 9h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
        <path d="M8 14q1.5 2 3 0m2 0q1.5 2 3 0" />
      </>
    ),
    parent: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="3" />
        <path d="M10 18h4M9 9a3 3 0 0 1 6 0c0 2-3 4-3 4s-3-2-3-4Z" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    'arrow-up-right': <path d="M6 18 18 6M6 6h12v12" />,
    scan: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 12h18" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Brand() {
  return (
    <span class="brand">
      <svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="22" fill="currentColor" />
        <path
          d="M16 35q7 9 14 0m5 0q7 9 14 0"
          fill="none"
          stroke="white"
          stroke-width="4"
          stroke-linecap="round"
        />
      </svg>
      <span>bambicam</span>
    </span>
  );
}
