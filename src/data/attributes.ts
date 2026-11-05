/**
 * Catálogo de atributos de jugador. Todas las claves son únicas entre grupos,
 * de modo que en CSV pueden usarse como nombre de columna sin prefijo.
 * Los textos visibles están en src/i18n (attr.<clave>).
 */

export const TECHNICAL_ATTRS = [
  'corners',
  'crossing',
  'dribbling',
  'finishing',
  'firstTouch',
  'freeKicks',
  'heading',
  'longShots',
  'longThrows',
  'marking',
  'passing',
  'penalties',
  'tackling',
  'technique',
] as const;

export const MENTAL_ATTRS = [
  'aggression',
  'anticipation',
  'bravery',
  'composure',
  'concentration',
  'decisions',
  'determination',
  'flair',
  'offTheBall',
  'leadership',
  'positioning',
  'teamwork',
  'vision',
  'workRate',
] as const;

export const PHYSICAL_ATTRS = [
  'acceleration',
  'agility',
  'balance',
  'jumping',
  'naturalFitness',
  'pace',
  'stamina',
  'strength',
] as const;

export const GOALKEEPING_ATTRS = [
  'aerialReach',
  'communication',
  'handling',
  'kicking',
  'reflexes',
  'oneOnOnes',
  'playWithFeet',
] as const;

export const HIDDEN_ATTRS = [
  'consistency',
  'importantMatches',
  'injuryProneness',
  'versatility',
  'ambition',
  'loyalty',
  'professionalism',
  'temperament',
] as const;

export type TechnicalAttr = (typeof TECHNICAL_ATTRS)[number];
export type MentalAttr = (typeof MENTAL_ATTRS)[number];
export type PhysicalAttr = (typeof PHYSICAL_ATTRS)[number];
export type GoalkeepingAttr = (typeof GOALKEEPING_ATTRS)[number];
export type HiddenAttr = (typeof HIDDEN_ATTRS)[number];

/** Atributos visibles (los que cuentan para la habilidad actual). */
export type VisibleAttr = TechnicalAttr | MentalAttr | PhysicalAttr | GoalkeepingAttr;
export type AttrKey = VisibleAttr | HiddenAttr;

export const ATTRIBUTE_GROUPS = {
  technical: TECHNICAL_ATTRS,
  mental: MENTAL_ATTRS,
  physical: PHYSICAL_ATTRS,
  goalkeeping: GOALKEEPING_ATTRS,
  hidden: HIDDEN_ATTRS,
} as const;

export type AttributeGroup = keyof typeof ATTRIBUTE_GROUPS;

export const VISIBLE_ATTRS: readonly VisibleAttr[] = [
  ...TECHNICAL_ATTRS,
  ...MENTAL_ATTRS,
  ...PHYSICAL_ATTRS,
  ...GOALKEEPING_ATTRS,
];

export const ALL_ATTRS: readonly AttrKey[] = [...VISIBLE_ATTRS, ...HIDDEN_ATTRS];

export const ATTR_GROUP_OF: Record<AttrKey, AttributeGroup> = Object.fromEntries(
  (Object.keys(ATTRIBUTE_GROUPS) as AttributeGroup[]).flatMap((g) =>
    ATTRIBUTE_GROUPS[g].map((a) => [a, g]),
  ),
) as Record<AttrKey, AttributeGroup>;

export const ATTR_MIN = 1;
export const ATTR_MAX = 20;
export const ABILITY_MIN = 1;
export const ABILITY_MAX = 200;

/** Forma plana de los atributos: { passing: 14, pace: 12, ... }. */
export type FlatAttributes = Record<AttrKey, number>;

export function isAttrKey(k: string): k is AttrKey {
  return (ALL_ATTRS as readonly string[]).includes(k);
}
