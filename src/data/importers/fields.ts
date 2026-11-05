/**
 * Utilidades del importador: nombres de columna con alias (inglés/español,
 * snake_case/camelCase), y parsers tolerantes de números, fechas y listas.
 */
import { ALL_ATTRS, type AttrKey } from '../attributes';
import { isValidIso, isoFromParts } from '../../engine/date';
import { es } from '../../i18n/es';

/** Normaliza un nombre de columna: minúsculas, sin acentos ni separadores. */
export function normKey(k: string): string {
  return k
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export type RawRecord = Record<string, unknown>;

/**
 * Aplana un objeto JSON anidado a claves normalizadas:
 * { contract: { wage: 1 } } -> { contractwage: 1, wage: 1 }.
 * También se registra la clave final sin prefijo si no colisiona,
 * de modo que `attributes.passing` se encuentra como `passing`.
 * Los arrays se conservan tal cual.
 */
export function flattenRecord(obj: RawRecord): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const leafCount = new Map<string, number>();
  const walk = (o: RawRecord, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix + normKey(k);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(v as RawRecord, key);
      } else {
        out.set(key, v);
        if (prefix) {
          const leaf = normKey(k);
          leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
        }
      }
    }
  };
  walk(obj, '');
  // Hojas sin prefijo (solo si no existen ya y no son ambiguas)
  const addLeaves = (o: RawRecord, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix + normKey(k);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) addLeaves(v as RawRecord, key);
      else if (prefix) {
        const leaf = normKey(k);
        if (!out.has(leaf) && leafCount.get(leaf) === 1) out.set(leaf, v);
      }
    }
  };
  addLeaves(obj, '');
  return out;
}

/** Busca el primer alias presente y no vacío. */
export function pick(rec: Map<string, unknown>, aliases: readonly string[]): unknown {
  for (const a of aliases) {
    const v = rec.get(a);
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return undefined;
}

export class FieldError extends Error {}

/** Número tolerante: "1.250.000", "1,5", "2.5M", "800k", "€ 3 000". */
export function parseNumber(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new FieldError(`número no válido: ${v}`);
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = String(v).trim().replace(/[€$£\s]/g, '');
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return undefined;
  let mult = 1;
  const suf = s.match(/([kmb])$/i);
  if (suf) {
    const c = (suf[1] as string).toLowerCase();
    mult = c === 'k' ? 1e3 : c === 'm' ? 1e6 : 1e9;
    s = s.slice(0, -1);
  }
  if (s.endsWith('%')) s = s.slice(0, -1);
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // El último separador es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // "1,5" decimal; "1,250,000" miles
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.250.000"
  }
  const n = Number(s) * mult;
  if (!Number.isFinite(n)) throw new FieldError(`número no válido: "${String(v)}"`);
  return n;
}

export function parseInt0(v: unknown): number | undefined {
  const n = parseNumber(v);
  return n === undefined ? undefined : Math.round(n);
}

/** Fecha en AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, AAAA/MM/DD o marca ISO completa. */
export function parseDate(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return undefined;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const iso = isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
    if (isValidIso(iso) && Number(iso.slice(5, 7)) === Number(m[2])) return iso;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const iso = isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
    if (Number(iso.slice(5, 7)) === Number(m[2])) return iso;
  }
  throw new FieldError(`fecha no válida: "${s}" (usa AAAA-MM-DD o DD/MM/AAAA)`);
}

/** Lista separada por ; | o , (o array JSON). */
export function parseList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)).trim()).filter(Boolean);
  const s = String(v).trim();
  if (s === '') return [];
  const sep = s.includes(';') ? ';' : s.includes('|') ? '|' : ',';
  return s.split(sep).map((x) => x.trim()).filter(Boolean);
}

export function parseBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = normKey(String(v));
  if (['1', 'true', 'si', 'yes', 'y', 's', 'verdadero'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'falso'].includes(s)) return false;
  throw new FieldError(`booleano no válido: "${String(v)}"`);
}

export function slug(s: string): string {
  return normKey(s).slice(0, 40) || 'x';
}

// ---------------------------------------------------------------- alias
export const PLAYER_FIELDS = {
  id: ['id', 'playerid', 'idjugador', 'jugadorid'],
  externalId: ['externalid', 'sourceid', 'idexterno'],
  firstName: ['firstname', 'nombre', 'givenname', 'forename'],
  lastName: ['lastname', 'apellido', 'apellidos', 'surname', 'familyname'],
  fullName: ['name', 'fullname', 'nombrecompleto', 'player', 'jugador'],
  commonName: ['commonname', 'apodo', 'knownas', 'displayname', 'nombrecorto'],
  birthDate: ['birthdate', 'dateofbirth', 'dob', 'fechanacimiento', 'fechadenacimiento', 'nacimiento'],
  age: ['age', 'edad'],
  nationalities: ['nationalities', 'nationality', 'nacionalidad', 'nacionalidades', 'nation', 'nationid', 'country', 'pais'],
  heightCm: ['heightcm', 'height', 'altura', 'estatura'],
  weightKg: ['weightkg', 'weight', 'peso'],
  foot: ['preferredfoot', 'foot', 'pie', 'piepreferido', 'piehabil'],
  footLeft: ['footleft', 'leftfoot', 'pieizquierdo', 'izquierdo'],
  footRight: ['footright', 'rightfoot', 'piederecho', 'derecho'],
  positions: ['positions', 'position', 'posiciones', 'posicion', 'pos'],
  positionMinutes: ['positionminutes', 'minutesbyposition', 'minutosporposicion'],
  clubId: ['clubid', 'club', 'teamid', 'team', 'equipo', 'equipoid'],
  wage: ['contractwage', 'wage', 'weeklywage', 'salario', 'salariosemanal'],
  annualWage: ['annualwage', 'wageannual', 'salarioanual', 'yearlywage'],
  contractExpires: ['contractexpires', 'contractend', 'expires', 'contractuntil', 'fincontrato', 'contratohasta', 'contractexpiresdate'],
  releaseClause: ['contractreleaseclause', 'releaseclause', 'clausula', 'clausularescision', 'clausuladerescision'],
  marketValue: ['marketvalue', 'value', 'valor', 'valormercado', 'valordemercado'],
  ca: ['ca', 'currentability', 'habilidadactual'],
  pa: ['pa', 'potentialability', 'potencial', 'habilidadpotencial'],
  condition: ['condition', 'condicion', 'condicionfisica'],
  morale: ['morale', 'moral'],
  minutes: ['minutes', 'minutesplayed', 'minutos', 'min', 'mins'],
  competitionId: ['competitionid', 'leagueid', 'league', 'liga', 'competicion', 'competition'],
  leagueStrength: ['leaguestrength', 'fuerzaliga'],
  personality: ['personality', 'personalidad'],
} as const;

export const CLUB_FIELDS = {
  id: ['id', 'clubid', 'teamid', 'idclub'],
  externalId: ['externalid', 'sourceid', 'idexterno'],
  name: ['name', 'nombre', 'club', 'team', 'equipo'],
  shortName: ['shortname', 'nombrecorto', 'abbreviation', 'abreviatura'],
  nation: ['nationid', 'nation', 'country', 'pais', 'nacion'],
  city: ['city', 'ciudad', 'town'],
  reputation: ['reputation', 'reputacion', 'rep'],
  founded: ['founded', 'fundacion', 'fundado', 'yearfounded'],
  primaryColor: ['colorsprimary', 'primarycolor', 'color1', 'colorprimario', 'colorprincipal'],
  secondaryColor: ['colorssecondary', 'secondarycolor', 'color2', 'colorsecundario'],
  stadiumName: ['stadiumname', 'stadium', 'estadio', 'nombreestadio'],
  capacity: ['stadiumcapacity', 'capacity', 'aforo', 'capacidad'],
  pitch: ['stadiumpitchcondition', 'pitchcondition', 'cesped', 'estadocesped'],
  training: ['facilitiestraining', 'trainingfacilities', 'training', 'instalacionesentrenamiento', 'entrenamiento'],
  youth: ['facilitiesyouth', 'youthfacilities', 'youth', 'instalacionescantera', 'cantera'],
  youthRecruitment: ['facilitiesyouthrecruitment', 'youthrecruitment', 'captacion', 'reclutamientojuvenil'],
  juniorCoaching: ['facilitiesjuniorcoaching', 'juniorcoaching', 'formacionjuvenil'],
  balance: ['financesbalance', 'balance', 'saldo', 'caja'],
  transferBudget: ['financestransferbudget', 'transferbudget', 'presupuestofichajes', 'presupuestotraspasos'],
  wageBudget: ['financeswagebudget', 'wagebudget', 'presupuestosalarial', 'presupuestosalarios'],
  debt: ['financesdebt', 'debt', 'deuda'],
  revenue: ['revenue', 'annualrevenue', 'ingresos', 'ingresosanuales'],
  leagueId: ['leagueid', 'league', 'competitionid', 'liga', 'division', 'competicion'],
  rivals: ['rivals', 'rivales'],
  homeShirt: ['kitshomeshirt', 'homeshirt', 'camisetalocal', 'equipacionlocal'],
  homeSecondary: ['kitshomesecondary', 'homesecondary', 'secundariolocal'],
  homePattern: ['kitshomepattern', 'homepattern', 'disenolocal'],
  homeShorts: ['kitshomeshorts', 'homeshorts', 'pantalonlocal'],
  awayShirt: ['kitsawayshirt', 'awayshirt', 'camisetavisitante', 'equipacionvisitante'],
  awaySecondary: ['kitsawaysecondary', 'awaysecondary', 'secundariovisitante'],
  awayPattern: ['kitsawaypattern', 'awaypattern', 'disenovisitante'],
  awayShorts: ['kitsawayshorts', 'awayshorts', 'pantalonvisitante'],
  gkShirt: ['kitsgoalkeepershirt', 'gkshirt', 'goalkeepershirt', 'camisetaportero'],
} as const;

export const COMPETITION_FIELDS = {
  id: ['id', 'competitionid', 'leagueid', 'idcompeticion'],
  name: ['name', 'nombre', 'competition', 'competicion', 'league', 'liga'],
  shortName: ['shortname', 'nombrecorto', 'abbreviation'],
  nation: ['nationid', 'nation', 'country', 'pais', 'nacion'],
  format: ['format', 'formato', 'type', 'tipo'],
  level: ['level', 'nivel', 'division', 'tier'],
  reputation: ['reputation', 'reputacion'],
  strength: ['strength', 'fuerza', 'leaguestrength'],
  teamIds: ['teamids', 'teams', 'equipos', 'clubs', 'clubes'],
  startDate: ['schedulestartdate', 'startdate', 'inicio', 'fechainicio'],
  endDate: ['scheduleenddate', 'enddate', 'fin', 'fechafin'],
  promoted: ['promotionpromoted', 'promoted', 'ascensos'],
  relegated: ['promotionrelegated', 'relegated', 'descensos'],
  upCompetitionId: ['promotionupcompetitionid', 'upcompetitionid', 'ligasuperior'],
  downCompetitionId: ['promotiondowncompetitionid', 'downcompetitionid', 'ligainferior'],
} as const;

export const NATION_FIELDS = {
  id: ['id', 'nationid', 'idnacion'],
  name: ['name', 'nombre', 'country', 'pais'],
  code: ['code', 'codigo', 'iso', 'iso3', 'fifacode'],
  continent: ['continent', 'continente', 'confederation', 'confederacion'],
  reputation: ['reputation', 'reputacion'],
  leagueStrength: ['leaguestrength', 'fuerzaliga', 'strength'],
  mandatoryReleaseClause: ['mandatoryreleaseclause', 'clausulaobligatoria'],
} as const;

/** Mapa nombre de columna normalizado -> clave de atributo (inglés, snake o etiqueta española). */
export const ATTRIBUTE_COLUMN: ReadonlyMap<string, AttrKey> = (() => {
  const m = new Map<string, AttrKey>();
  const labels = es.attr as Record<string, string>;
  for (const a of ALL_ATTRS) {
    m.set(normKey(a), a);
    m.set('attributes' + normKey(a), a);
    m.set('attr' + normKey(a), a);
    const label = labels[a];
    if (label) m.set(normKey(label), a);
  }
  return m;
})();
