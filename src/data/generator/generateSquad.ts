/**
 * Plantilla ficticia suelta a un nivel dado (para calibración, pruebas y amistosos).
 */
import { clamp, type Rng } from '../../engine/rng';
import type { Player } from '../schema';
import { generatePlayer } from './generatePlayer';
import { SQUAD_TEMPLATE, TIER_OFFSET, ageForTier } from './generateWorld';
import { NAME_STYLES } from './nameStyles';

export interface SquadGenInput {
  clubId: string;
  /** CA media aproximada de los titulares. */
  level: number;
  reputation?: number;
  refDate?: string;
  nationId?: string;
  style?: string;
  /** Desviación de la CA individual (por defecto 6). */
  spread?: number;
}

export function generateSquad(rng: Rng, i: SquadGenInput): Player[] {
  const style = NAME_STYLES[i.style ?? 'iberico'] ?? (NAME_STYLES.iberico as NonNullable<(typeof NAME_STYLES)['iberico']>);
  return SQUAD_TEMPLATE.map(([position, tier], k) => {
    const id = `${i.clubId}_p${k + 1}`;
    return generatePlayer(rng.fork(id), {
      id,
      position,
      targetCA: clamp(i.level + TIER_OFFSET[tier] + rng.normal(0, i.spread ?? 6), 20, 195),
      age: ageForTier(rng, tier),
      refDate: i.refDate ?? '2026-07-01',
      nationId: i.nationId ?? 'n_test',
      style,
      clubId: i.clubId,
      clubName: i.clubId,
      clubReputation: i.reputation ?? 5000,
      mandatoryReleaseClause: false,
      youth: tier === 'youth',
    });
  }).map((p) => ({ ...p, condition: 100, matchSharpness: 80, morale: 60 }));
}
