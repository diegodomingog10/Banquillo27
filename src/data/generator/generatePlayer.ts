/**
 * Generación de jugadores ficticios coherentes: los atributos se construyen a partir
 * de una CA objetivo y del perfil de la posición, y después la CA se recalcula con
 * computeCA para que ambas cosas encajen exactamente.
 */
import { clamp, type Rng } from '../../engine/rng';
import { addDays, isoFromParts } from '../../engine/date';
import {
  GOALKEEPING_ATTRS,
  HIDDEN_ATTRS,
  VISIBLE_ATTRS,
  type FlatAttributes,
  type VisibleAttr,
} from '../attributes';
import {
  computeCA,
  positionOffset,
  derivePersonality,
  estimateMarketValue,
  estimateWage,
  rawAbilityForGroup,
  roundMoney,
} from '../ability';
import { GROUP_OF_POSITION, RELATED_POSITIONS, type Position } from '../positions';
import type { Contract, Player, PositionRating } from '../schema';
import { firstName, lastName, type NameStyle } from './nameStyles';

const GK_SET = new Set<string>(GOALKEEPING_ATTRS);
const LEFT_SIDE = new Set<Position>(['LB', 'LWB', 'LM', 'LW']);
const RIGHT_SIDE = new Set<Position>(['RB', 'RWB', 'RM', 'RW']);

export interface AttributeGenInput {
  targetCA: number;
  position: Position;
  age: number;
  heightCm: number;
  weightKg: number;
}

/**
 * Genera atributos (1-20) cuya CA calculada se aproxima a targetCA.
 * Exportado porque el importador lo usa para rellenar huecos de forma coherente.
 */
export function generateAttributes(rng: Rng, i: AttributeGenInput): FlatAttributes {
  const group = GROUP_OF_POSITION[i.position];
  const isGk = group === 'GK';
  const level = i.targetCA / 10;
  const spread = 4.2;
  const raw: Record<string, number> = {};

  for (const a of VISIBLE_ATTRS) {
    const isGkAttr = GK_SET.has(a);
    let v: number;
    if (!isGk && isGkAttr) {
      v = rng.normal(2.2, 1);
    } else if (isGk && !isGkAttr && (a === 'finishing' || a === 'dribbling' || a === 'crossing' ||
      a === 'longShots' || a === 'heading' || a === 'tackling' || a === 'marking' || a === 'corners' ||
      a === 'freeKicks' || a === 'longThrows' || a === 'offTheBall' || a === 'flair' || a === 'technique')) {
      v = rng.normal(level * 0.45, 1.5);
    } else {
      v = level + positionOffset(group, a as VisibleAttr, spread) + rng.normal(0, 1.6);
    }
    raw[a] = v;
  }

  // Edad
  if (i.age < 21) {
    const d = (21 - i.age) * 0.7;
    for (const a of ['composure', 'decisions', 'positioning', 'anticipation', 'leadership', 'strength', 'concentration'] as const) {
      raw[a] = (raw[a] ?? 10) - d;
    }
  } else if (i.age > 29) {
    const d = (i.age - 29) * 0.6;
    for (const a of ['pace', 'acceleration', 'agility', 'stamina', 'naturalFitness'] as const) raw[a] = (raw[a] ?? 10) - d;
    for (const a of ['decisions', 'positioning', 'anticipation', 'leadership', 'composure'] as const) raw[a] = (raw[a] ?? 10) + d * 0.5;
  }

  // Físico según altura y peso
  const h = (i.heightCm - 181) / 4;
  raw.jumping = (raw.jumping ?? 10) + h * 0.8;
  raw.heading = (raw.heading ?? 10) + h * 0.5;
  raw.aerialReach = (raw.aerialReach ?? 10) + (isGk ? h * 0.8 : 0);
  raw.strength = (raw.strength ?? 10) + (i.weightKg - 76) / 5;
  raw.agility = (raw.agility ?? 10) - h * 0.4;
  raw.balance = (raw.balance ?? 10) - h * 0.3;

  // Balón parado y saques largos: dispersión mayor (especialistas)
  for (const a of ['corners', 'freeKicks', 'penalties', 'longThrows'] as const) {
    if (!isGk) raw[a] = (raw[a] ?? 10) + rng.normal(0, 2.5);
  }

  const toAttrs = (shift: number): FlatAttributes => {
    const out = {} as FlatAttributes;
    for (const a of VISIBLE_ATTRS) {
      const affected = isGk ? true : !GK_SET.has(a);
      out[a] = clamp(Math.round((raw[a] ?? 10) + (affected ? shift : 0)), 1, 20);
    }
    for (const a of HIDDEN_ATTRS) out[a] = 10;
    return out;
  };

  // Ajuste iterativo del desplazamiento para clavar la CA objetivo.
  let shift = 0;
  let attrs = toAttrs(shift);
  for (let it = 0; it < 8; it++) {
    const ca = rawAbilityForGroup(attrs, group);
    const diff = i.targetCA - ca;
    if (Math.abs(diff) < 1.5) break;
    shift += diff / 10;
    attrs = toAttrs(shift);
  }

  // Rasgos de carácter: poco ligados al nivel (si no, todo jugador modesto sería "poco decidido").
  attrs.determination = clamp(Math.round(rng.normal(11 + (level - 10) * 0.2, 3.5)), 1, 20);
  attrs.leadership = clamp(Math.round(rng.normal(9 + (level - 10) * 0.25 + (i.age - 25) * 0.25, 3.5)), 1, 20);

  // Ocultos
  attrs.consistency = clamp(Math.round(rng.normal(10 + (level - 10) * 0.3, 3.5)), 1, 20);
  attrs.importantMatches = clamp(Math.round(rng.normal(10 + (level - 10) * 0.25, 3.5)), 1, 20);
  attrs.injuryProneness = clamp(Math.round(rng.normal(8, 3.5)), 1, 20);
  attrs.versatility = clamp(Math.round(rng.normal(10, 4)), 1, 20);
  attrs.ambition = clamp(Math.round(rng.normal(11 + (level - 10) * 0.2, 3.5)), 1, 20);
  attrs.loyalty = clamp(Math.round(rng.normal(11, 4)), 1, 20);
  attrs.professionalism = clamp(Math.round(rng.normal(11 + (level - 10) * 0.2, 3.5)), 1, 20);
  attrs.temperament = clamp(Math.round(rng.normal(11, 3.5)), 1, 20);
  return attrs;
}

export function generatePositions(rng: Rng, main: Position, versatility: number): PositionRating[] {
  const out: PositionRating[] = [{ position: main, rating: 20 }];
  const related = RELATED_POSITIONS[main];
  const pBoost = (versatility - 10) * 0.03;
  for (const [pos, base] of Object.entries(related) as [Position, number][]) {
    if (rng.chance(0.55 + pBoost)) {
      out.push({ position: pos, rating: clamp(Math.round(base + rng.normal(versatility > 14 ? 2 : 0, 3)), 2, 19) });
    }
  }
  return out;
}

function generateFoot(rng: Rng, main: Position): { left: number; right: number; preferred: Player['preferredFoot'] } {
  const pLeft = LEFT_SIDE.has(main) ? 0.6 : RIGHT_SIDE.has(main) ? 0.12 : 0.23;
  if (rng.chance(0.03)) {
    return { left: rng.int(15, 20), right: rng.int(15, 20), preferred: 'either' };
  }
  const strong = rng.int(18, 20);
  const weak = clamp(Math.round(rng.normal(8, 3.5)), 1, 16);
  return rng.chance(pLeft)
    ? { left: strong, right: weak, preferred: 'left' }
    : { left: weak, right: strong, preferred: 'right' };
}

function heightFor(rng: Rng, main: Position): number {
  const mean = main === 'GK' ? 190 : main === 'CB' ? 187 : main === 'ST' ? 183 : main === 'DM' ? 181 : 177;
  return clamp(Math.round(rng.normal(mean, 5.5)), 160, 205);
}

export interface PlayerGenInput {
  id: string;
  position: Position;
  targetCA: number;
  /** PA deseada (si se omite se calcula por edad). */
  targetPA?: number;
  age: number;
  /** Fecha de referencia (inicio de partida). */
  refDate: string;
  nationId: string;
  secondNationId?: string | null;
  style: NameStyle;
  clubId: string | null;
  clubName: string;
  clubReputation: number;
  mandatoryReleaseClause: boolean;
  youth?: boolean;
}

export function generatePlayer(rng: Rng, i: PlayerGenInput): Player {
  const heightCm = heightFor(rng, i.position);
  const weightKg = clamp(Math.round(heightCm - 105 + rng.normal(0, 5)), 55, 110);
  const attributes = generateAttributes(rng, {
    targetCA: i.targetCA,
    position: i.position,
    age: i.age,
    heightCm,
    weightKg,
  });
  const positions = generatePositions(rng, i.position, attributes.versatility);
  const foot = generateFoot(rng, i.position);
  const ca = computeCA(attributes, i.position);

  let pa: number;
  if (i.targetPA !== undefined) pa = i.targetPA;
  else if (i.age <= 23) pa = ca + Math.round((24 - i.age) * rng.float(2, 8.5) * (0.7 + attributes.professionalism / 33));
  else if (i.age <= 29) pa = ca + rng.int(0, 8);
  else pa = ca + rng.int(0, 14);
  pa = clamp(Math.max(pa, ca), ca, 200);

  // Fecha de nacimiento dentro del año correspondiente a la edad
  const refYear = Number(i.refDate.slice(0, 4));
  const birthDate = addDays(isoFromParts(refYear - i.age - 1, 7, 2), rng.int(0, 363));

  let contract: Contract | null = null;
  let marketValue: number;
  if (i.clubId) {
    const years = i.youth ? rng.int(1, 3) : rng.int(1, 5);
    const expires = isoFromParts(refYear + years, 6, 30);
    const wage = roundMoney(estimateWage(ca, i.clubReputation, i.age) * rng.float(0.8, 1.25));
    marketValue = estimateMarketValue({ ca, pa, age: i.age, contractYears: years, clubReputation: i.clubReputation });
    const hasClause = i.mandatoryReleaseClause || rng.chance(0.2);
    contract = {
      wage,
      expires,
      releaseClause: hasClause ? roundMoney(Math.max(marketValue, 100000) * rng.float(2, 5)) : null,
      bonuses: {
        appearance: roundMoney(wage * 0.1),
        goal: GROUP_OF_POSITION[i.position] === 'ST' || GROUP_OF_POSITION[i.position] === 'WIDE' || GROUP_OF_POSITION[i.position] === 'AM'
          ? roundMoney(wage * 0.25) : 0,
        cleanSheet: i.position === 'GK' || GROUP_OF_POSITION[i.position] === 'CB' ? roundMoney(wage * 0.15) : 0,
        signing: 0,
        loyalty: 0,
      },
      type: i.youth ? 'youth' : 'full',
      loanFromClubId: null,
    };
  } else {
    marketValue = estimateMarketValue({ ca, pa, age: i.age, contractYears: 0, clubReputation: 1500 });
  }

  const joinedYearsAgo = i.clubId ? rng.int(0, Math.max(0, Math.min(i.age - 17, 7))) : 0;
  const nationalities = [i.nationId];
  if (i.secondNationId && i.secondNationId !== i.nationId) nationalities.push(i.secondNationId);

  return {
    id: i.id,
    firstName: firstName(rng, i.style),
    lastName: lastName(rng, i.style),
    commonName: null,
    birthDate,
    nationalities,
    heightCm,
    weightKg,
    foot: { left: foot.left, right: foot.right },
    preferredFoot: foot.preferred,
    positions,
    clubId: i.clubId,
    contract,
    marketValue,
    ca,
    pa,
    personality: derivePersonality(attributes),
    attributes,
    condition: rng.int(88, 100),
    matchSharpness: rng.int(35, 60),
    morale: rng.int(50, 75),
    form: [],
    injury: null,
    cards: { yellow: 0, red: 0, suspendedMatches: 0 },
    seasonStats: [],
    careerStats: [],
    history: i.clubId
      ? [{ clubId: i.clubId, clubName: i.clubName, from: isoFromParts(refYear - joinedYearsAgo, 7, 1), to: null, fee: 0, loan: false }]
      : [],
    estimated: [],
    source: 'generated',
    externalId: null,
  };
}
