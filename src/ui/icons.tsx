/** Iconos de línea propios (mismo trazo en toda la interfaz). */
import type { SVGProps } from 'react';

export const ICONS = {
  alert: 'M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.2v.3',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  shirt: 'M9 4 4 7l2 4 2-1v10h8V10l2 1 2-4-5-3c-.5 1.5-1.7 2.2-3 2.2S9.5 5.5 9 4z',
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v6H4z',
  squad: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6M2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M15 14.6c2.3.2 4.2 1.7 5 4.4',
  tactics: 'M4 4h16v16H4zM12 4v16M4 12h4M16 12h4',
  training: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  transfers: 'M7 7h12l-3-3M17 17H5l3 3',
  finance: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3',
  club: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  folder: 'M4 7h6l2 2h8v9H4z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1',
  medical: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  news: 'M5 5h11v14H6a1 1 0 0 1-1-1zM16 9h3v9a1 1 0 0 1-1 1h-2M8 9h5M8 13h5M8 16h3',
  list: 'M4 5h16M4 12h16M4 19h10',
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8l4 3-1.5 4.5h-5L8 11z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  docCheck: 'M7 3h7l4 4v14H7zM14 3v4h4M10 14l2 2 4-4',
  chart: 'M5 20V11M12 20V5M19 20v-8M3 20h18',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  glove: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z',
  cross: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4',
  compare: 'M8 7 4 11l4 4M16 7l4 4-4 4M4 11h16',
  loan: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  star: 'm12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.3-5.5-2.9-5.5 2.9 1-6.3L3 9.7l6.2-.9z',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M15 4v4M9 10v4M18 16v4',
  radar: 'M12 3 21 9.5 17.5 20h-11L3 9.5zM12 8l4 3-1.5 4.5h-5L8 11z',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  heart: 'M20.5 8.5c0 5.5-8.5 11-8.5 11s-8.5-5.5-8.5-11A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5zM7 12h3l1.5-2.5 2 4 1.5-1.5h2',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  gauge: 'M3 15a9 9 0 0 1 18 0M12 15l4-5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  reset: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12 3M19 9A7 7 0 0 0 7 6',
  columns: 'M4 4h16v16H4zM10 4v16M15 4v16',
  whistle: 'M3 10h11a5 5 0 1 1-5 5V10M14 10V6h3',
  check: 'm5 12 5 5 9-10',
  swap: 'M7 4v16M7 20l-3-3M7 4 4 7M17 20V4M17 4l3 3M17 20l3-3',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, strokeWidth = 1.8, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const dotted = name === 'grip' || name === 'more';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={dotted ? 3 : strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={ICONS[name]} />
    </svg>
  );
}
