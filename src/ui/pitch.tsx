/**
 * Campo de fútbol realista (césped con franjas de corte y marcas reglamentarias) y
 * equipaciones (camiseta con su diseño y disco de jugador para la vista 2D).
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Kit } from '../data/kits';

// Medidas reglamentarias en metros
const L = 105;
const W = 68;
const M = 4; // margen alrededor del rectángulo de juego

export type Orientation = 'horizontal' | 'vertical';

/** Posición en % del contenedor para un punto del campo (x: 0 propia portería → 1 rival; y: 0 → 1). */
export function pitchPos(x: number, y: number, orientation: Orientation = 'horizontal'): { left: number; top: number } {
  if (orientation === 'horizontal') return { left: ((M + x * L) / (L + 2 * M)) * 100, top: ((M + y * W) / (W + 2 * M)) * 100 };
  return { left: ((M + y * W) / (W + 2 * M)) * 100, top: ((M + (1 - x) * L) / (L + 2 * M)) * 100 };
}

export const PITCH_ASPECT: Record<Orientation, string> = { horizontal: `${L + 2 * M} / ${W + 2 * M}`, vertical: `${W + 2 * M} / ${L + 2 * M}` };

function Markings() {
  const line = { fill: 'none', stroke: 'rgba(255,255,255,0.88)', strokeWidth: 0.22 } as const;
  const arcDy = Math.sqrt(9.15 ** 2 - 5.5 ** 2);
  const box = (side: 0 | 1) => {
    const gx = side === 0 ? 0 : L;
    const dir = side === 0 ? 1 : -1;
    const pen = gx + dir * 11;
    const edge = gx + dir * 16.5;
    return (
      <g key={side}>
        <rect x={Math.min(gx, edge)} y={(W - 40.32) / 2} width={16.5} height={40.32} {...line} />
        <rect x={Math.min(gx, gx + dir * 5.5)} y={(W - 18.32) / 2} width={5.5} height={18.32} {...line} />
        <circle cx={pen} cy={W / 2} r={0.28} fill="rgba(255,255,255,0.9)" />
        <path d={`M ${edge} ${W / 2 - arcDy} A 9.15 9.15 0 0 ${side === 0 ? 1 : 0} ${edge} ${W / 2 + arcDy}`} {...line} />
        <rect x={side === 0 ? -2 : L} y={(W - 7.32) / 2} width={2} height={7.32} fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.9)" strokeWidth={0.22} />
      </g>
    );
  };
  return (
    <g>
      <rect x={0} y={0} width={L} height={W} {...line} />
      <line x1={L / 2} y1={0} x2={L / 2} y2={W} {...line} />
      <circle cx={L / 2} cy={W / 2} r={9.15} {...line} />
      <circle cx={L / 2} cy={W / 2} r={0.3} fill="rgba(255,255,255,0.9)" />
      {box(0)}{box(1)}
      {[[0, 0, 0, 1], [L, 0, 1, 1], [0, W, 0, 0], [L, W, 1, 0]].map(([x, y, sx, sy], i) => (
        <path key={i} d={`M ${x! + (sx ? -1 : 1)} ${y} A 1 1 0 0 ${sx === sy ? 1 : 0} ${x} ${y! + (sy ? 1 : -1)}`} {...line} />
      ))}
    </g>
  );
}

/** Campo de fútbol. Los hijos se colocan encima en coordenadas % (usa `pitchPos`). */
export function FootballPitch({ orientation = 'horizontal', children, className, label, style }: {
  orientation?: Orientation; children?: ReactNode; className?: string; label?: string; style?: CSSProperties;
}) {
  const stripes = 14;
  const g = (
    <g>
      <rect x={-M} y={-M} width={L + 2 * M} height={W + 2 * M} fill="#2F7A33" />
      {Array.from({ length: stripes }, (_, i) => (
        <rect key={i} x={(i * L) / stripes} y={0} width={L / stripes} height={W} fill={i % 2 === 0 ? '#3D9440' : '#358A39'} />
      ))}
      <Markings />
    </g>
  );
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl ${className ?? ''}`} style={{ aspectRatio: PITCH_ASPECT[orientation], ...style }} role={label ? 'img' : undefined} aria-label={label}>
      <svg className="absolute inset-0 h-full w-full" viewBox={orientation === 'horizontal' ? `${-M} ${-M} ${L + 2 * M} ${W + 2 * M}` : `${-M} ${-M} ${W + 2 * M} ${L + 2 * M}`} aria-hidden="true">
        {orientation === 'horizontal' ? g : <g transform={`matrix(0,-1,1,0,0,${L})`}>{g}</g>}
      </svg>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- equipaciones
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Color de texto legible sobre la camiseta. */
export function kitInk(k: Kit): string {
  return luminance(k.shirt) > 0.4 ? '#111111' : '#FFFFFF';
}

/** Color representativo del equipo que se vea sobre fondo oscuro (barras, marcas). */
export function kitAccent(k: Kit): string {
  return luminance(k.shirt) < 0.03 && luminance(k.secondary) > luminance(k.shirt) ? k.secondary : k.shirt;
}

/** Fondo CSS de la camiseta según su diseño. */
export function kitBackground(k: Kit, unit = 4): string {
  const a = k.shirt;
  const b = k.secondary;
  switch (k.pattern) {
    case 'stripes': return `repeating-linear-gradient(90deg, ${a} 0 ${unit}px, ${b} ${unit}px ${unit * 2}px)`;
    case 'pinstripes': return `repeating-linear-gradient(90deg, ${a} 0 ${unit + 2}px, ${b} ${unit + 2}px ${unit + 3}px)`;
    case 'hoops': return `repeating-linear-gradient(0deg, ${a} 0 ${unit}px, ${b} ${unit}px ${unit * 2}px)`;
    case 'halves': return `linear-gradient(90deg, ${a} 50%, ${b} 50%)`;
    case 'sash': return `linear-gradient(135deg, ${a} 0 36%, ${b} 36% 62%, ${a} 62%)`;
    case 'sleeves': return `radial-gradient(circle, ${a} 52%, ${b} 54%)`;
    default: return a;
  }
}

/** Disco de jugador con su equipación (vista 2D y pizarra táctica). */
export function KitDisc({ kit, size = 22, label, selected, className }: { kit: Kit; size?: number; label?: string; selected?: boolean; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className ?? ''}`}
      style={{
        width: size, height: size, background: kitBackground(kit, Math.max(2, size / 6)), color: kitInk(kit), fontSize: Math.max(8, size * 0.36),
        border: `2px solid ${kit.shorts}`, boxShadow: selected ? '0 0 0 3px #A78BFA' : '0 1px 3px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.35)',
        textShadow: kitInk(kit) === '#FFFFFF' ? '0 1px 1px rgba(0,0,0,0.6)' : 'none',
      }}>
      {label}
    </span>
  );
}

/** Camiseta dibujada (para marcadores, previa y ficha de club). */
export function KitShirt({ kit, size = 40, title }: { kit: Kit; size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  const a = kit.shirt;
  const b = kit.secondary;
  const fill = `url(#k${id})`;
  const pattern = (() => {
    switch (kit.pattern) {
      case 'stripes': return <pattern id={`k${id}`} width="8" height="40" patternUnits="userSpaceOnUse"><rect width="4" height="40" fill={a} /><rect x="4" width="4" height="40" fill={b} /></pattern>;
      case 'pinstripes': return <pattern id={`k${id}`} width="6" height="40" patternUnits="userSpaceOnUse"><rect width="6" height="40" fill={a} /><rect x="5" width="1" height="40" fill={b} /></pattern>;
      case 'hoops': return <pattern id={`k${id}`} width="40" height="8" patternUnits="userSpaceOnUse"><rect width="40" height="4" fill={a} /><rect y="4" width="40" height="4" fill={b} /></pattern>;
      case 'halves': return <linearGradient id={`k${id}`} x1="0" x2="1" y1="0" y2="0"><stop offset="0.5" stopColor={a} /><stop offset="0.5" stopColor={b} /></linearGradient>;
      case 'sash': return <linearGradient id={`k${id}`} x1="0" x2="1" y1="0" y2="1"><stop offset="0.38" stopColor={a} /><stop offset="0.38" stopColor={b} /><stop offset="0.6" stopColor={b} /><stop offset="0.6" stopColor={a} /></linearGradient>;
      default: return <linearGradient id={`k${id}`}><stop stopColor={a} /></linearGradient>;
    }
  })();
  const sleeves = kit.pattern === 'sleeves' ? b : fill;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>{pattern}</defs>
      <path d="M8 9 L1 15 L5 21 L9 18 Z" fill={sleeves} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
      <path d="M32 9 L39 15 L35 21 L31 18 Z" fill={sleeves} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
      <path d="M14 5 Q20 9 26 5 L32 9 L31 37 L9 37 L8 9 Z" fill={fill} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
      <path d="M14 5 Q20 10 26 5" fill="none" stroke={b} strokeWidth="1.6" />
    </svg>
  );
}
