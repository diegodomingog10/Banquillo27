/**
 * Posiciones del campo. Los códigos internos son neutros (inglés corto) para evitar
 * la ambigüedad clásica "DC" (defensa central en FM inglés / delantero centro en español).
 * La etiqueta visible se toma de i18n (pos.<código>).
 */

export const POSITIONS = [
  'GK',
  'LB',
  'CB',
  'RB',
  'LWB',
  'RWB',
  'DM',
  'LM',
  'CM',
  'RM',
  'LW',
  'AM',
  'RW',
  'ST',
] as const;

export type Position = (typeof POSITIONS)[number];

/** Grupos posicionales usados para percentiles, CA y generación. */
export const POSITION_GROUPS = ['GK', 'CB', 'FB', 'DM', 'CM', 'WIDE', 'AM', 'ST'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const GROUP_OF_POSITION: Record<Position, PositionGroup> = {
  GK: 'GK',
  CB: 'CB',
  LB: 'FB',
  RB: 'FB',
  LWB: 'FB',
  RWB: 'FB',
  DM: 'DM',
  CM: 'CM',
  LM: 'WIDE',
  RM: 'WIDE',
  LW: 'WIDE',
  RW: 'WIDE',
  AM: 'AM',
  ST: 'ST',
};

/**
 * Posiciones afines: si un jugador domina la clave, suele poder jugar en estas
 * con el nivel indicado (1-20). Se usa para estimar posiciones secundarias.
 */
export const RELATED_POSITIONS: Record<Position, Partial<Record<Position, number>>> = {
  GK: {},
  CB: { DM: 9, LB: 8, RB: 8 },
  LB: { LWB: 15, LM: 10, CB: 8 },
  RB: { RWB: 15, RM: 10, CB: 8 },
  LWB: { LB: 15, LM: 13, LW: 9 },
  RWB: { RB: 15, RM: 13, RW: 9 },
  DM: { CM: 15, CB: 9 },
  CM: { DM: 13, AM: 12, LM: 8, RM: 8 },
  LM: { LW: 15, LWB: 11, CM: 9, RM: 8 },
  RM: { RW: 15, RWB: 11, CM: 9, LM: 8 },
  LW: { LM: 15, RW: 11, AM: 10, ST: 9 },
  RW: { RM: 15, LW: 11, AM: 10, ST: 9 },
  AM: { CM: 13, ST: 11, LW: 9, RW: 9 },
  ST: { AM: 10, LW: 8, RW: 8 },
};

/**
 * Alias aceptados en importaciones. Se normalizan a mayúsculas sin espacios ni puntos.
 * "DC" se interpreta en español (delantero centro). Para el sentido FM-inglés
 * (defensa central) usar "CB" o "DFC". Ver DATA_GUIDE.md.
 */
export const POSITION_ALIASES: Record<string, Position> = {
  // Internos
  GK: 'GK', LB: 'LB', CB: 'CB', RB: 'RB', LWB: 'LWB', RWB: 'RWB', DM: 'DM', LM: 'LM',
  CM: 'CM', RM: 'RM', LW: 'LW', AM: 'AM', RW: 'RW', ST: 'ST',
  // Inglés habituales
  G: 'GK', GOALKEEPER: 'GK', DCL: 'CB', DCR: 'CB', D: 'CB', DEF: 'CB', DL: 'LB', DR: 'RB',
  WBL: 'LWB', WBR: 'RWB', DMC: 'DM', CDM: 'DM', MC: 'CM', MCL: 'CM', MCR: 'CM', M: 'CM',
  ML: 'LM', MR: 'RM', CAM: 'AM', AMC: 'AM', AML: 'LW', AMR: 'RW', LF: 'LW', RF: 'RW',
  CF: 'ST', FW: 'ST', F: 'ST', SS: 'AM', STC: 'ST',
  // Español
  POR: 'GK', PT: 'GK', DFC: 'CB', CT: 'CB', LI: 'LB', LD: 'RB', CRI: 'LWB', CRD: 'RWB',
  MCD: 'DM', MI: 'LM', MD: 'RM', MCO: 'AM', MP: 'AM', EI: 'LW', ED: 'RW', DC: 'ST', DEL: 'ST',
};

export function parsePosition(raw: string): Position | null {
  const key = raw.trim().toUpperCase().replace(/[\s.\-_]/g, '');
  return POSITION_ALIASES[key] ?? null;
}

export function isPosition(s: string): s is Position {
  return (POSITIONS as readonly string[]).includes(s);
}
