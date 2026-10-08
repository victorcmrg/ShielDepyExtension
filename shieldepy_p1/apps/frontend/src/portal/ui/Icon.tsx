// Ícones de traço dos painéis (24×24, stroke 1.7) — mesmo desenho do antigo dashboard.js.
import type { ReactNode } from 'react';

const PATHS = {
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M15.5 14.6c2.3.2 4 1.6 4.7 4.4" />
    </>
  ),
  building: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8.5 7.5h2M13.5 7.5h2M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M10.5 20.5v-3h3v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  device: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11" rx="1.8" />
      <path d="M8.5 19.5h7M12 15.5v4" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5c.7 3 1.9 4.2 4.9 4.9-3 .7-4.2 1.9-4.9 4.9-.7-3-1.9-4.2-4.9-4.9 3-.7 4.2-1.9 4.9-4.9Z" />
      <path d="M18.5 14.5c.4 1.7 1.1 2.4 2.8 2.8-1.7.4-2.4 1.1-2.8 2.8-.4-1.7-1.1-2.4-2.8-2.8 1.7-.4 2.4-1.1 2.8-2.8Z" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19 6v5.6c0 4.5-2.9 7.4-7 8.7-4.1-1.3-7-4.2-7-8.7V6l7-2.8Z" />
      <path d="m8.7 12 2.2 2.2 4.2-4.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5.2" y="10.8" width="13.6" height="9.5" rx="2.4" />
      <path d="M8 10.8V7.8a4 4 0 0 1 8 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5" />,
  edit: (
    <>
      <path d="M4.5 19.5h4l10-10-4-4-10 10v4Z" />
      <path d="m13 6.5 4 4" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M4.5 12h14.5M13 6l6 6-6 6" />,
  key: (
    <>
      <circle cx="8" cy="15" r="3.5" />
      <path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  code: (
    <>
      <path d="m9 8-4.5 4L9 16" />
      <path d="m15 8 4.5 4L15 16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />,
  branch: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M7 8.2v7.6M17 10.2c0 3.6-4.5 3.4-8.4 6.2" />
    </>
  ),
  repo: <path d="M6.5 4.5h11a1 1 0 0 1 1 1v13.2a.8.8 0 0 1-1.2.7L12 16.6l-5.3 2.8a.8.8 0 0 1-1.2-.7V5.5a1 1 0 0 1 1-1Z" />,
  logout: (
    <>
      <path d="M14.5 5.5h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
      <path d="M10 8.5 6.5 12l3.5 3.5M6.5 12h9" />
    </>
  ),
  menu: <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />,
  external: (
    <>
      <path d="M13.5 5.5h5v5M18.5 5.5 11 13" />
      <path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5" />
    </>
  ),
  grid: (
    <>
      <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.5" />
      <rect x="13" y="13" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.3 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.3-3.4-8.5s1.1-6.1 3.4-8.5Z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <span className="sd-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {PATHS[name]}
      </svg>
    </span>
  );
}
