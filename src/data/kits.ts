/**
 * Equipaciones: camiseta, color secundario (rayas, mangas, ribetes), diseño, pantalón y
 * medias. Cada club tiene equipación local, visitante y de portero. En cada partido se
 * eligen las que no se confundan (como hace el árbitro con las camisetas).
 */
import { z } from 'zod';
import type { Rng } from '../engine/rng';

export const KIT_PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'sleeves', 'pinstripes'] as const;
export type KitPattern = (typeof KIT_PATTERNS)[number];

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Kit = z.object({
  shirt: Hex,
  secondary: Hex,
  pattern: z.enum(KIT_PATTERNS).default('plain'),
  shorts: Hex,
  socks: Hex,
});
export type Kit = z.infer<typeof Kit>;

export const Kits = z.object({ home: Kit, away: Kit, goalkeeper: Kit });
export type Kits = z.infer<typeof Kits>;

/** Colores de equipación (nombres para el importador y la interfaz). */
export const KIT_COLORS: Record<string, string> = {
  rojo: '#C8102E', granate: '#7A1F2B', azul: '#1D4FA8', marino: '#14213D', celeste: '#6CABDD', blanco: '#F5F5F2',
  negro: '#151515', amarillo: '#F4C20D', verde: '#00843D', naranja: '#F26B1D', morado: '#5B2C8F', gris: '#8A8D91',
  oro: '#C9A24A', rosa: '#E0569A', turquesa: '#0FA3A3', vino: '#5C1A33',
};
const C = KIT_COLORS;

/** Combinaciones clásicas [camiseta, secundario, pantalón, medias]. */
const CLASSIC: readonly [string, string, string, string][] = [
  [C.rojo!, C.blanco!, C.blanco!, C.rojo!], [C.rojo!, C.blanco!, C.rojo!, C.rojo!], [C.blanco!, C.negro!, C.negro!, C.blanco!],
  [C.blanco!, C.azul!, C.azul!, C.blanco!], [C.azul!, C.blanco!, C.blanco!, C.azul!], [C.azul!, C.rojo!, C.azul!, C.azul!],
  [C.marino!, C.blanco!, C.marino!, C.marino!], [C.celeste!, C.blanco!, C.blanco!, C.celeste!], [C.celeste!, C.marino!, C.marino!, C.celeste!],
  [C.amarillo!, C.negro!, C.negro!, C.amarillo!], [C.amarillo!, C.azul!, C.azul!, C.amarillo!], [C.verde!, C.blanco!, C.blanco!, C.verde!],
  [C.verde!, C.negro!, C.negro!, C.verde!], [C.granate!, C.celeste!, C.blanco!, C.granate!], [C.granate!, C.blanco!, C.blanco!, C.granate!],
  [C.naranja!, C.negro!, C.negro!, C.naranja!], [C.negro!, C.blanco!, C.negro!, C.negro!], [C.negro!, C.amarillo!, C.negro!, C.negro!],
  [C.morado!, C.blanco!, C.blanco!, C.morado!], [C.blanco!, C.rojo!, C.blanco!, C.blanco!], [C.rojo!, C.negro!, C.negro!, C.rojo!],
  [C.azul!, C.amarillo!, C.azul!, C.azul!], [C.blanco!, C.verde!, C.blanco!, C.blanco!], [C.vino!, C.oro!, C.blanco!, C.vino!],
];
const AWAY_NEUTRAL = [C.blanco!, C.negro!, C.gris!, C.marino!, C.amarillo!, C.celeste!];
const GK_COLORS = [C.verde!, C.naranja!, C.amarillo!, C.gris!, C.negro!, C.rosa!, C.turquesa!, C.morado!];

/** Diseños según el par de colores (las rayas, con dos colores bien distintos). */
function patternFor(rng: Rng): KitPattern {
  return rng.weighted([...KIT_PATTERNS], [52, 18, 7, 5, 5, 9, 4]);
}

export function generateKits(rng: Rng): Kits {
  const [shirt, secondary, shorts, socks] = rng.pick(CLASSIC);
  const home: Kit = { shirt, secondary, pattern: patternFor(rng), shorts, socks };
  // Visitante: invertida (secundario como camiseta) o un neutro con ribete del color del club
  let away: Kit;
  if (rng.chance(0.5) && colorDistance(secondary, shirt) > 120) {
    away = { shirt: secondary, secondary: shirt, pattern: rng.chance(0.75) ? 'plain' : 'sleeves', shorts: secondary, socks: secondary };
  } else {
    const base = rng.pick(AWAY_NEUTRAL.filter((c) => colorDistance(c, shirt) > 160)) ?? C.blanco!;
    away = { shirt: base, secondary: shirt, pattern: rng.chance(0.8) ? 'plain' : 'sash', shorts: base, socks: base };
  }
  const gkShirt = rng.pick(GK_COLORS.filter((c) => colorDistance(c, shirt) > 140 && colorDistance(c, away.shirt) > 140)) ?? C.verde!;
  const goalkeeper: Kit = { shirt: gkShirt, secondary: C.negro!, pattern: 'plain', shorts: gkShirt, socks: gkShirt };
  return { home, away, goalkeeper };
}

/** Equipaciones del club; si no tiene (datos antiguos o importados), se derivan de sus colores. */
export function kitsOf(club: { colors: { primary: string; secondary: string }; kits?: Kits | undefined }): Kits {
  if (club.kits) return club.kits;
  const p = club.colors.primary;
  const s = club.colors.secondary;
  const awayShirt = colorDistance(s, p) > 120 ? s : colorDistance(p, C.blanco!) > 160 ? C.blanco! : C.negro!;
  const gk = GK_COLORS.find((c) => colorDistance(c, p) > 140 && colorDistance(c, awayShirt) > 140) ?? C.verde!;
  return {
    home: { shirt: p, secondary: s, pattern: 'plain', shorts: s, socks: p },
    away: { shirt: awayShirt, secondary: p, pattern: 'plain', shorts: awayShirt, socks: awayShirt },
    goalkeeper: { shirt: gk, secondary: C.negro!, pattern: 'plain', shorts: gk, socks: gk },
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Distancia perceptual aproximada entre dos colores (0-765). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Choque entre dos equipaciones: se mira sobre todo la camiseta. */
export function kitsClash(a: Kit, b: Kit): boolean {
  return colorDistance(a.shirt, b.shirt) < 170;
}

export interface MatchKits {
  home: Kit;
  away: Kit;
  homeGk: Kit;
  awayGk: Kit;
  /** Qué equipación lleva el visitante. */
  awayKit: 'home' | 'away' | 'third';
}

/** Elige las equipaciones del partido: el local juega de local; el visitante cambia si choca. */
export function matchKits(homeClub: Parameters<typeof kitsOf>[0], awayClub: Parameters<typeof kitsOf>[0]): MatchKits {
  const h = kitsOf(homeClub);
  const a = kitsOf(awayClub);
  let away = a.home;
  let awayKit: MatchKits['awayKit'] = 'home';
  if (kitsClash(h.home, a.home)) {
    away = a.away;
    awayKit = 'away';
    if (kitsClash(h.home, a.away)) {
      const shirt = colorDistance(h.home.shirt, C.blanco!) > colorDistance(h.home.shirt, C.negro!) ? C.blanco! : C.negro!;
      away = { shirt, secondary: a.home.shirt, pattern: 'plain', shorts: shirt, socks: shirt };
      awayKit = 'third';
    }
  }
  let awayGk = a.goalkeeper;
  const used = [h.home, away];
  if (used.some((k) => kitsClash(k, awayGk)) || kitsClash(h.goalkeeper, awayGk)) {
    const c = GK_COLORS.find((x) => used.every((k) => colorDistance(k.shirt, x) > 170) && colorDistance(h.goalkeeper.shirt, x) > 170) ?? C.rosa!;
    awayGk = { ...awayGk, shirt: c, shorts: c, socks: c };
  }
  return { home: h.home, away, homeGk: h.goalkeeper, awayGk, awayKit };
}
