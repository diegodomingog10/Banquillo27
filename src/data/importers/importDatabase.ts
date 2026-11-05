/**
 * Importador de bases de datos (CSV y JSON) a `WorldDatabase`.
 *
 * Diseño:
 *  - Independiente del entorno: recibe archivos como { name, content } (lo usan la
 *    CLI `npm run import` y la pantalla "Importar base de datos").
 *  - Nunca se rompe por una fila mala: cada fila con error se descarta y se informa
 *    (archivo, fila, campo, mensaje); el resto se importa.
 *  - Detecta duplicados (mismo id = error; mismo nombre + fecha de nacimiento o
 *    mismo nombre de club en la misma nación = aviso).
 *  - Lo que falta se rellena con valores coherentes y se marca en `estimated`.
 *  - Las estadísticas reales se convierten en atributos con statsToAttributes.
 */
import { clamp, createRng } from '../../engine/rng';
import { addDays, ageAt, isoFromParts } from '../../engine/date';
import {
  computeCA,
  derivePersonality,
  estimateMarketValue,
  estimatePA,
  estimateWage,
  fullWeights,
  mainPosition,
  roundMoney,
} from '../ability';
import { HIDDEN_ATTRS, VISIBLE_ATTRS, type AttrKey, type FlatAttributes } from '../attributes';
import { GROUP_OF_POSITION, RELATED_POSITIONS, parsePosition, type Position } from '../positions';
import {
  Club as ClubSchema,
  Competition as CompetitionSchema,
  Nation as NationSchema,
  PersonalityType,
  Player as PlayerSchema,
  SCHEMA_VERSION,
  Staff as StaffSchema,
  StaffRole,
  STAFF_ATTRS,
  WorldDatabase as WorldSchema,
  type Club,
  type Competition,
  type Nation,
  type Player,
  type PositionRating,
  type Staff,
  type WorldDatabase,
} from '../schema';
import {
  DEFAULT_STATS_MAPPING,
  convertStatsToAttributes,
  resolveLeagueStrength,
  type StatsMapping,
  type StatsPlayer,
} from '../statsToAttributes';
import { annualRevenue, clubLevel, generateClubStaff, SQUAD_TEMPLATE, TIER_OFFSET, ageForTier } from '../generator/generateWorld';
import { generateAttributes, generatePlayer } from '../generator/generatePlayer';
import { NAME_STYLES } from '../generator/nameStyles';
import { es } from '../../i18n/es';
import { parseCsv } from './csv';
import {
  ATTRIBUTE_COLUMN,
  CLUB_FIELDS,
  COMPETITION_FIELDS,
  FieldError,
  NATION_FIELDS,
  PLAYER_FIELDS,
  flattenRecord,
  normKey,
  parseBool,
  parseDate,
  parseInt0,
  parseList,
  parseNumber,
  pick,
  slug,
} from './fields';

// ---------------------------------------------------------------- tipos públicos
export type EntityKind = 'player' | 'club' | 'competition' | 'nation' | 'staff';

export interface ImportFile {
  name: string;
  content: string;
  /** Fuerza el tipo de entidad (si no, se deduce del nombre del archivo o del JSON). */
  entity?: EntityKind;
}

export interface ImportIssue {
  severity: 'error' | 'warning' | 'info';
  file: string;
  /** Fila en el archivo (línea en CSV contando la cabecera como 1; índice+1 en JSON). */
  row: number | null;
  entity: EntityKind | 'file';
  id: string | null;
  field: string | null;
  message: string;
}

export interface ImportOptions {
  /** Base sobre la que fusionar (p. ej. el mundo generado). Sin base = base de datos nueva. */
  base?: WorldDatabase;
  startDate?: string;
  season?: string;
  mapping?: StatsMapping;
  /** Completar plantillas con jugadores ficticios hasta `minSquad` y crear staff si falta. */
  fillSquads?: boolean;
  minSquad?: number;
  name?: string;
}

export interface EntityCounts {
  read: number;
  imported: number;
  skipped: number;
}

export interface ImportResult {
  database: WorldDatabase;
  issues: ImportIssue[];
  counts: Record<EntityKind, EntityCounts>;
  /** Jugadores con algún dato estimado. */
  playersEstimated: number;
  /** Jugadores con atributos derivados de estadísticas. */
  playersFromStats: number;
  /** Jugadores ficticios añadidos para completar plantillas. */
  generatedFill: number;
  errorCount: number;
  warningCount: number;
}

// ---------------------------------------------------------------- internos
interface Rec {
  file: string;
  row: number;
  data: Map<string, unknown>;
}

const KIND_KEYWORDS: [EntityKind, RegExp][] = [
  ['staff', /staff|tecnico|entrenador|coach/],
  ['player', /player|jugador|plantilla|squad/],
  ['competition', /competition|competicion|league|liga|torneo|tournament/],
  ['club', /club|team|equipo/],
  ['nation', /nation|nacion|countr|pais/],
];

function kindFromName(name: string): EntityKind | null {
  const n = normKey(name.replace(/\.[a-z]+$/i, ''));
  for (const [k, re] of KIND_KEYWORDS) if (re.test(n)) return k;
  return null;
}

const BUNDLE_KEYS: Record<string, EntityKind> = {
  players: 'player', jugadores: 'player',
  clubs: 'club', clubes: 'club', teams: 'club', equipos: 'club',
  competitions: 'competition', competiciones: 'competition', leagues: 'competition', ligas: 'competition',
  nations: 'nation', naciones: 'nation', countries: 'nation', paises: 'nation',
  staff: 'staff',
};

class Importer {
  issues: ImportIssue[] = [];
  counts: Record<EntityKind, EntityCounts> = {
    player: { read: 0, imported: 0, skipped: 0 },
    club: { read: 0, imported: 0, skipped: 0 },
    competition: { read: 0, imported: 0, skipped: 0 },
    nation: { read: 0, imported: 0, skipped: 0 },
    staff: { read: 0, imported: 0, skipped: 0 },
  };
  records: Record<EntityKind, Rec[]> = { player: [], club: [], competition: [], nation: [], staff: [] };

  nations = new Map<string, Nation>();
  clubs = new Map<string, Club>();
  competitions = new Map<string, Competition>();
  players = new Map<string, Player>();
  staff = new Map<string, Staff>();
  imported = { nation: new Set<string>(), club: new Set<string>(), competition: new Set<string>(), player: new Set<string>(), staff: new Set<string>() };

  startDate: string;
  season: string;
  refYear: number;
  mapping: StatsMapping;
  playersFromStats = 0;
  generatedFill = 0;

  constructor(private opts: ImportOptions) {
    this.startDate = opts.startDate ?? opts.base?.meta.startDate ?? '2026-07-01';
    this.refYear = Number(this.startDate.slice(0, 4));
    this.season = opts.season ?? opts.base?.meta.season ?? `${this.refYear}/${String((this.refYear + 1) % 100).padStart(2, '0')}`;
    this.mapping = opts.mapping ?? DEFAULT_STATS_MAPPING;
    if (opts.base) {
      for (const n of opts.base.nations) this.nations.set(n.id, n);
      for (const c of opts.base.clubs) this.clubs.set(c.id, c);
      for (const c of opts.base.competitions) this.competitions.set(c.id, c);
      for (const p of opts.base.players) this.players.set(p.id, p);
      for (const s of opts.base.staff) this.staff.set(s.id, s);
    }
  }

  issue(i: Omit<ImportIssue, 'severity'> & { severity?: ImportIssue['severity'] }): void {
    this.issues.push({ severity: i.severity ?? 'error', ...i });
  }

  // ------------------------------------------------ lectura de archivos
  readFile(f: ImportFile): void {
    const isJson = /\.json$/i.test(f.name) || /^\s*[[{]/.test(f.content);
    if (isJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(f.content);
      } catch (e) {
        this.issue({ file: f.name, row: null, entity: 'file', id: null, field: null, message: `JSON no válido: ${(e as Error).message}` });
        return;
      }
      if (Array.isArray(parsed)) {
        const kind = f.entity ?? kindFromName(f.name);
        if (!kind) {
          this.issue({ file: f.name, row: null, entity: 'file', id: null, field: null, message: 'no se puede deducir el tipo de entidad por el nombre del archivo (usa players/clubs/competitions/nations/staff en el nombre)' });
          return;
        }
        this.addRecords(kind, f.name, parsed, (i) => i + 1);
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        let found = false;
        for (const [key, val] of Object.entries(obj)) {
          const kind = BUNDLE_KEYS[normKey(key)];
          if (kind && Array.isArray(val)) {
            found = true;
            this.addRecords(kind, `${f.name}#${key}`, val, (i) => i + 1);
          }
        }
        if (!found) this.issue({ file: f.name, row: null, entity: 'file', id: null, field: null, message: 'el JSON no contiene listas reconocibles (players, clubs, competitions, nations, staff)' });
      }
      return;
    }
    const kind = f.entity ?? kindFromName(f.name);
    if (!kind) {
      this.issue({ file: f.name, row: null, entity: 'file', id: null, field: null, message: 'no se puede deducir el tipo de entidad por el nombre del archivo (usa players/clubs/competitions/nations/staff en el nombre)' });
      return;
    }
    const csv = parseCsv(f.content);
    for (const m of csv.malformed) {
      this.issue({ severity: 'warning', file: f.name, row: m.line, entity: kind, id: null, field: null, message: `la fila tiene ${m.got} columnas y la cabecera ${m.expected}` });
    }
    csv.rows.forEach((row, i) => {
      const data = new Map<string, unknown>();
      for (const [k, v] of Object.entries(row)) data.set(normKey(k), v);
      this.records[kind].push({ file: f.name, row: csv.lineNumbers[i] ?? i + 2, data });
    });
  }

  private addRecords(kind: EntityKind, file: string, list: unknown[], rowOf: (i: number) => number): void {
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        this.issue({ file, row: rowOf(i), entity: kind, id: null, field: null, message: 'el elemento no es un objeto' });
        this.counts[kind].read++;
        this.counts[kind].skipped++;
        return;
      }
      this.records[kind].push({ file, row: rowOf(i), data: flattenRecord(item as Record<string, unknown>) });
    });
  }

  // ------------------------------------------------ ayudas
  /** Ejecuta un parser de campo y convierte FieldError en incidencia (devuelve undefined). */
  field<T>(rec: Rec, kind: EntityKind, id: string | null, name: string, fn: () => T, severity: ImportIssue['severity'] = 'warning'): T | undefined {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FieldError) {
        this.issue({ severity, file: rec.file, row: rec.row, entity: kind, id, field: name, message: `${e.message}; se ignora el valor` });
        return undefined;
      }
      throw e;
    }
  }

  findNation(raw: string): Nation | undefined {
    const k = normKey(raw);
    if (this.nations.has(raw)) return this.nations.get(raw);
    for (const n of this.nations.values()) {
      if (normKey(n.id) === k || normKey(n.code) === k || normKey(n.name) === k) return n;
    }
    return undefined;
  }

  resolveNation(raw: string, rec: Rec, kind: EntityKind, id: string | null): string {
    const found = this.findNation(raw);
    if (found) return found.id;
    const nid = `n_${slug(raw)}`;
    const nation: Nation = {
      id: nid,
      name: raw,
      code: raw.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'UNK',
      continent: 'Desconocido',
      reputation: 5000,
      leagueStrength: this.mapping.settings.defaultLeagueStrength,
      mandatoryReleaseClause: false,
    };
    this.nations.set(nid, nation);
    this.imported.nation.add(nid);
    this.issue({ severity: 'info', file: rec.file, row: rec.row, entity: kind, id, field: 'nation', message: `nación "${raw}" creada automáticamente (reputación y fuerza de liga estimadas)` });
    return nid;
  }

  findClub(raw: string): Club | undefined {
    if (this.clubs.has(raw)) return this.clubs.get(raw);
    const k = normKey(raw);
    for (const c of this.clubs.values()) if (normKey(c.id) === k || normKey(c.name) === k) return c;
    return undefined;
  }

  findCompetition(raw: string): Competition | undefined {
    if (this.competitions.has(raw)) return this.competitions.get(raw);
    const k = normKey(raw);
    for (const c of this.competitions.values()) if (normKey(c.id) === k || normKey(c.name) === k) return c;
    return undefined;
  }

  leagueOfClub(clubId: string): Competition | undefined {
    for (const c of this.competitions.values()) if (c.format === 'league' && c.teamIds.includes(clubId)) return c;
    return undefined;
  }

  validId(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(s) ? s : s.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 64);
  }

  // ------------------------------------------------ naciones
  processNations(): void {
    const seen = new Map<string, Rec>();
    for (const rec of this.records.nation) {
      this.counts.nation.read++;
      const name = pick(rec.data, NATION_FIELDS.name);
      const id = this.validId(pick(rec.data, NATION_FIELDS.id)) ?? (name ? `n_${slug(String(name))}` : null);
      if (!id || !name) {
        this.issue({ file: rec.file, row: rec.row, entity: 'nation', id, field: id ? 'name' : 'id', message: 'falta el id o el nombre de la nación' });
        this.counts.nation.skipped++;
        continue;
      }
      const dup = seen.get(id);
      if (dup) {
        this.issue({ file: rec.file, row: rec.row, entity: 'nation', id, field: 'id', message: `id duplicado (ya aparece en ${dup.file}, fila ${dup.row})` });
        this.counts.nation.skipped++;
        continue;
      }
      seen.set(id, rec);
      const estimated: string[] = [];
      const rep = this.field(rec, 'nation', id, 'reputation', () => parseInt0(pick(rec.data, NATION_FIELDS.reputation)));
      const str = this.field(rec, 'nation', id, 'leagueStrength', () => parseNumber(pick(rec.data, NATION_FIELDS.leagueStrength)));
      if (rep === undefined) estimated.push('reputation');
      if (str === undefined) estimated.push('leagueStrength');
      const nation = {
        id,
        name: String(name),
        code: String(pick(rec.data, NATION_FIELDS.code) ?? String(name).slice(0, 3)).toUpperCase().slice(0, 4),
        continent: String(pick(rec.data, NATION_FIELDS.continent) ?? 'Desconocido'),
        reputation: clamp(rep ?? 5000, 0, 10000),
        leagueStrength: clamp(str ?? (rep !== undefined ? rep / 100 : this.mapping.settings.defaultLeagueStrength), 0, 100),
        mandatoryReleaseClause: this.field(rec, 'nation', id, 'mandatoryReleaseClause', () => parseBool(pick(rec.data, NATION_FIELDS.mandatoryReleaseClause))) ?? false,
      };
      const r = NationSchema.safeParse(nation);
      if (!r.success) {
        this.zodIssues(rec, 'nation', id, r.error.issues);
        this.counts.nation.skipped++;
        continue;
      }
      if (this.nations.has(id) && this.opts.base) this.issue({ severity: 'info', file: rec.file, row: rec.row, entity: 'nation', id, field: null, message: 'reemplaza a la nación existente con el mismo id' });
      this.nations.set(id, r.data);
      this.imported.nation.add(id);
      this.counts.nation.imported++;
    }
  }

  zodIssues(rec: Rec, kind: EntityKind, id: string | null, issues: readonly { path: PropertyKey[]; message: string }[]): void {
    for (const iss of issues.slice(0, 6)) {
      this.issue({ file: rec.file, row: rec.row, entity: kind, id, field: iss.path.map(String).join('.') || null, message: `valor no válido: ${iss.message}` });
    }
  }

  // ------------------------------------------------ clubes
  pendingClubLeague = new Map<string, { raw: string; rec: Rec }>();
  clubRepEstimated = new Set<string>();

  processClubs(): void {
    const seen = new Map<string, Rec>();
    const byName = new Map<string, string>();
    for (const c of this.clubs.values()) byName.set(`${c.nationId}|${normKey(c.name)}`, c.id);
    for (const rec of this.records.club) {
      this.counts.club.read++;
      const nameRaw = pick(rec.data, CLUB_FIELDS.name);
      let id = this.validId(pick(rec.data, CLUB_FIELDS.id));
      if (!nameRaw) {
        this.issue({ file: rec.file, row: rec.row, entity: 'club', id, field: 'name', message: 'falta el nombre del club' });
        this.counts.club.skipped++;
        continue;
      }
      const name = String(nameRaw).trim();
      if (!id) {
        id = `cl_${slug(name)}`;
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'club', id, field: 'id', message: `sin id: se usa "${id}"` });
      }
      const dup = seen.get(id);
      if (dup) {
        this.issue({ file: rec.file, row: rec.row, entity: 'club', id, field: 'id', message: `id duplicado (ya aparece en ${dup.file}, fila ${dup.row}); se descarta esta fila` });
        this.counts.club.skipped++;
        continue;
      }
      const nationRaw = pick(rec.data, CLUB_FIELDS.nation);
      if (!nationRaw) {
        this.issue({ file: rec.file, row: rec.row, entity: 'club', id, field: 'nation', message: 'falta la nación del club' });
        this.counts.club.skipped++;
        continue;
      }
      seen.set(id, rec);
      const nationId = this.resolveNation(String(nationRaw), rec, 'club', id);
      const nameKey = `${nationId}|${normKey(name)}`;
      const other = byName.get(nameKey);
      if (other && other !== id) {
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'club', id, field: 'name', message: `posible duplicado: mismo nombre y nación que el club "${other}"` });
      }
      byName.set(nameKey, id);

      const num = (f: string, aliases: readonly string[]) => this.field(rec, 'club', id, f, () => parseNumber(pick(rec.data, aliases)));
      const estimated: string[] = [];
      const repRaw = num('reputation', CLUB_FIELDS.reputation);
      // Reputación provisional; si falta se estima tras conocer la liga.
      const nation = this.nations.get(nationId);
      const reputation = clamp(Math.round(repRaw ?? (nation?.reputation ?? 5000) * 0.5), 0, 10000);
      if (repRaw === undefined) this.clubRepEstimated.add(id);

      const leagueRaw = pick(rec.data, CLUB_FIELDS.leagueId);
      if (leagueRaw) this.pendingClubLeague.set(id, { raw: String(leagueRaw), rec });

      const capacity = num('capacity', CLUB_FIELDS.capacity);
      const revenueRaw = num('revenue', CLUB_FIELDS.revenue);
      const transferBudget = num('transferBudget', CLUB_FIELDS.transferBudget);
      const wageBudget = num('wageBudget', CLUB_FIELDS.wageBudget);
      const balance = num('balance', CLUB_FIELDS.balance);
      const debt = num('debt', CLUB_FIELDS.debt);
      const pitch = num('pitch', CLUB_FIELDS.pitch);
      const fac = (f: string, aliases: readonly string[]) => {
        const v = num(f, aliases);
        if (v === undefined) estimated.push(`facilities.${f}`);
        return v;
      };
      const training = fac('training', CLUB_FIELDS.training);
      const youth = fac('youth', CLUB_FIELDS.youth);
      const youthRecruitment = fac('youthRecruitment', CLUB_FIELDS.youthRecruitment);
      const juniorCoaching = fac('juniorCoaching', CLUB_FIELDS.juniorCoaching);
      if (capacity === undefined) estimated.push('stadium.capacity');
      if (revenueRaw === undefined) estimated.push('finances.seasonIncome');
      if (transferBudget === undefined) estimated.push('finances.transferBudget');
      if (wageBudget === undefined) estimated.push('finances.wageBudget');
      if (balance === undefined) estimated.push('finances.balance');
      const color = (v: unknown, def: string) => {
        if (typeof v !== 'string') return def;
        const s = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`;
        return /^#[0-9a-fA-F]{6}$/.test(s) ? s : def;
      };
      const city = String(pick(rec.data, CLUB_FIELDS.city) ?? name);
      if (!pick(rec.data, CLUB_FIELDS.city)) estimated.push('city');

      const draft = {
        id,
        name,
        shortName: String(pick(rec.data, CLUB_FIELDS.shortName) ?? name).slice(0, 20),
        nationId,
        city,
        reputation,
        colors: { primary: color(pick(rec.data, CLUB_FIELDS.primaryColor), '#1d428a'), secondary: color(pick(rec.data, CLUB_FIELDS.secondaryColor), '#ffffff') },
        founded: this.field(rec, 'club', id, 'founded', () => parseInt0(pick(rec.data, CLUB_FIELDS.founded))) ?? null,
        stadium: {
          name: String(pick(rec.data, CLUB_FIELDS.stadiumName) ?? `Estadio de ${city}`),
          capacity: Math.round(capacity ?? 0),
          pitchCondition: clamp(pitch ?? 85, 0, 100),
          length: 105,
          width: 68,
        },
        facilities: {
          training: Math.round(training ?? 0),
          youth: Math.round(youth ?? 0),
          youthRecruitment: Math.round(youthRecruitment ?? 0),
          juniorCoaching: Math.round(juniorCoaching ?? 0),
        },
        finances: {
          balance: balance ?? NaN,
          transferBudget: transferBudget ?? NaN,
          wageBudget: wageBudget ?? NaN,
          debt: debt ?? 0,
          seasonIncome: { tickets: 0, tv: 0, sponsorship: 0, merchandising: 0, prizes: 0, transfers: 0 },
          ticketPrice: 0,
          seasonTicketHolders: 0,
        },
        staffIds: [] as string[],
        boardObjectives: [],
        philosophy: [],
        rivals: parseList(pick(rec.data, CLUB_FIELDS.rivals)),
        affiliateIds: [],
        estimated,
        source: 'imported' as const,
        externalId: (pick(rec.data, CLUB_FIELDS.externalId) as string | undefined) ?? null,
        _revenue: revenueRaw,
        _rec: rec,
      };
      this.clubDrafts.push(draft);
    }
  }

  clubDrafts: (Omit<Club, 'philosophy' | 'boardObjectives'> & { philosophy: Club['philosophy']; boardObjectives: Club['boardObjectives']; _revenue: number | undefined; _rec: Rec })[] = [];

  /** Rellena valores dependientes de la reputación (una vez conocida la liga) y valida. */
  finalizeClubs(): void {
    for (const d of this.clubDrafts) {
      const { _revenue, _rec, ...rest } = d;
      const league = this.leagueOfClub(d.id);
      if (this.clubRepEstimated.has(d.id)) {
        const nationRep = this.nations.get(d.nationId)?.reputation ?? 5000;
        const level = league?.level ?? 1;
        rest.reputation = clamp(Math.round(nationRep * (level <= 1 ? 0.6 : level === 2 ? 0.33 : 0.2)), 0, 10000);
        rest.estimated.push('reputation');
      }
      const rep = rest.reputation;
      const revenue = _revenue ?? annualRevenue(rep);
      const facBase = clamp(Math.round(3 + (rep / 10000) * 16), 1, 20);
      if (!rest.stadium.capacity) rest.stadium.capacity = clamp(Math.round((4000 + rep * 6.5) / 100) * 100, 1500, 99000);
      for (const k of ['training', 'youth', 'youthRecruitment', 'juniorCoaching'] as const) {
        if (!rest.facilities[k]) rest.facilities[k] = facBase;
        rest.facilities[k] = clamp(rest.facilities[k], 1, 20);
      }
      const f = rest.finances;
      f.seasonIncome = {
        tickets: roundMoney(revenue * 0.2), tv: roundMoney(revenue * 0.45), sponsorship: roundMoney(revenue * 0.25),
        merchandising: roundMoney(revenue * 0.1), prizes: 0, transfers: 0,
      };
      if (Number.isNaN(f.balance)) f.balance = roundMoney(revenue * 0.15);
      if (Number.isNaN(f.transferBudget)) f.transferBudget = roundMoney(revenue * 0.12);
      if (Number.isNaN(f.wageBudget)) f.wageBudget = -1; // se calcula con la plantilla
      f.ticketPrice = Math.round(10 + rep / 250);
      f.seasonTicketHolders = Math.round(rest.stadium.capacity * 0.4);
      const r = ClubSchema.safeParse({ ...rest, finances: { ...f, wageBudget: Math.max(0, f.wageBudget) } });
      if (!r.success) {
        this.zodIssues(_rec, 'club', d.id, r.error.issues);
        this.counts.club.skipped++;
        // quitar de ligas
        for (const c of this.competitions.values()) c.teamIds = c.teamIds.filter((t) => t !== d.id);
        continue;
      }
      const club = r.data;
      if (f.wageBudget < 0) (club as Club & { _wageEstimate?: boolean })._wageEstimate = true;
      if (this.clubs.has(club.id) && this.opts.base) this.issue({ severity: 'info', file: _rec.file, row: _rec.row, entity: 'club', id: club.id, field: null, message: 'reemplaza al club existente con el mismo id' });
      this.clubs.set(club.id, club);
      this.imported.club.add(club.id);
      this.counts.club.imported++;
    }
  }

  // ------------------------------------------------ competiciones
  processCompetitions(): void {
    const seen = new Map<string, Rec>();
    for (const rec of this.records.competition) {
      this.counts.competition.read++;
      const nameRaw = pick(rec.data, COMPETITION_FIELDS.name);
      let id = this.validId(pick(rec.data, COMPETITION_FIELDS.id));
      if (!nameRaw && !id) {
        this.issue({ file: rec.file, row: rec.row, entity: 'competition', id: null, field: 'id', message: 'faltan el id y el nombre de la competición' });
        this.counts.competition.skipped++;
        continue;
      }
      const name = String(nameRaw ?? id);
      if (!id) {
        id = `c_${slug(name)}`;
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'competition', id, field: 'id', message: `sin id: se usa "${id}"` });
      }
      const dup = seen.get(id);
      if (dup) {
        this.issue({ file: rec.file, row: rec.row, entity: 'competition', id, field: 'id', message: `id duplicado (ya aparece en ${dup.file}, fila ${dup.row})` });
        this.counts.competition.skipped++;
        continue;
      }
      seen.set(id, rec);
      const estimated: string[] = [];
      const fmtRaw = normKey(String(pick(rec.data, COMPETITION_FIELDS.format) ?? 'league'));
      const format: Competition['format'] =
        /group|grupo/.test(fmtRaw) ? 'groupCup' : /playoff/.test(fmtRaw) ? 'playoff' : /cup|copa|knockout|eliminatoria/.test(fmtRaw) ? 'cup' : 'league';
      const nationRaw = pick(rec.data, COMPETITION_FIELDS.nation);
      const nationId = nationRaw ? this.resolveNation(String(nationRaw), rec, 'competition', id) : null;
      const level = this.field(rec, 'competition', id, 'level', () => parseInt0(pick(rec.data, COMPETITION_FIELDS.level))) ?? (format === 'league' ? 1 : 0);
      const nationRep = nationId ? this.nations.get(nationId)?.reputation ?? 5000 : 7000;
      const repRaw = this.field(rec, 'competition', id, 'reputation', () => parseInt0(pick(rec.data, COMPETITION_FIELDS.reputation)));
      if (repRaw === undefined) estimated.push('reputation');
      const strength = this.field(rec, 'competition', id, 'strength', () => parseNumber(pick(rec.data, COMPETITION_FIELDS.strength))) ?? null;
      const teamsRaw = parseList(pick(rec.data, COMPETITION_FIELDS.teamIds));
      const startDate = this.field(rec, 'competition', id, 'startDate', () => parseDate(pick(rec.data, COMPETITION_FIELDS.startDate)));
      const endDate = this.field(rec, 'competition', id, 'endDate', () => parseDate(pick(rec.data, COMPETITION_FIELDS.endDate)));
      if (!startDate || !endDate) estimated.push('schedule');
      const promoted = this.field(rec, 'competition', id, 'promoted', () => parseInt0(pick(rec.data, COMPETITION_FIELDS.promoted)));
      const relegated = this.field(rec, 'competition', id, 'relegated', () => parseInt0(pick(rec.data, COMPETITION_FIELDS.relegated)));
      const up = pick(rec.data, COMPETITION_FIELDS.upCompetitionId);
      const down = pick(rec.data, COMPETITION_FIELDS.downCompetitionId);

      const teamIds: string[] = [];
      for (const t of teamsRaw) {
        const club = this.findClubDraftOrClub(t);
        if (!club) {
          this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'competition', id, field: 'teamIds', message: `club "${t}" no encontrado; se omite` });
          continue;
        }
        if (!teamIds.includes(club)) teamIds.push(club);
      }
      const draft = {
        id,
        name,
        shortName: String(pick(rec.data, COMPETITION_FIELDS.shortName) ?? name).slice(0, 20),
        nationId,
        continent: nationId ? this.nations.get(nationId)?.continent ?? null : null,
        format,
        level,
        reputation: clamp(repRaw ?? Math.round(nationRep * (level <= 1 ? 1 : 0.45)), 0, 10000),
        strength: strength === null ? null : clamp(strength, 0, 100),
        teamIds,
        rules: {},
        schedule: {
          startDate: startDate ?? isoFromParts(this.refYear, 8, 15),
          endDate: endDate ?? isoFromParts(this.refYear + 1, 5, 30),
        },
        prizes: {},
        promotion:
          format === 'league' && (promoted !== undefined || relegated !== undefined || up || down)
            ? {
                upCompetitionId: up ? String(up) : null,
                downCompetitionId: down ? String(down) : null,
                promoted: promoted ?? 0,
                relegated: relegated ?? 0,
              }
            : null,
        continentalSpots: [],
        estimated,
        source: 'imported',
      };
      const r = CompetitionSchema.safeParse(draft);
      if (!r.success) {
        this.zodIssues(rec, 'competition', id, r.error.issues);
        this.counts.competition.skipped++;
        continue;
      }
      this.competitions.set(id, r.data);
      this.imported.competition.add(id);
      this.counts.competition.imported++;
    }

    // Pertenencia declarada en los clubes (columna league_id / liga)
    for (const [clubId, { raw, rec }] of this.pendingClubLeague) {
      let comp = this.findCompetition(raw);
      if (!comp) {
        const nationId = this.clubDrafts.find((c) => c.id === clubId)?.nationId ?? null;
        const r = CompetitionSchema.safeParse({
          id: this.validId(raw)?.startsWith('c_') ? this.validId(raw) : `c_${slug(raw)}`,
          name: raw,
          shortName: raw.slice(0, 20),
          nationId,
          format: 'league',
          level: 1,
          reputation: Math.round((nationId ? this.nations.get(nationId)?.reputation ?? 5000 : 5000)),
          teamIds: [],
          rules: {},
          schedule: { startDate: isoFromParts(this.refYear, 8, 15), endDate: isoFromParts(this.refYear + 1, 5, 30) },
          prizes: {},
          estimated: ['level', 'reputation', 'schedule'],
          source: 'imported',
        });
        if (!r.success) continue;
        comp = r.data;
        this.competitions.set(comp.id, comp);
        this.imported.competition.add(comp.id);
        this.issue({ severity: 'info', file: rec.file, row: rec.row, entity: 'club', id: clubId, field: 'league', message: `competición "${raw}" creada automáticamente (nivel 1 estimado)` });
      }
      // Un club solo puede estar en una liga: lo sacamos de otras
      if (comp.format === 'league') {
        for (const c of this.competitions.values()) {
          if (c !== comp && c.format === 'league' && c.teamIds.includes(clubId)) c.teamIds = c.teamIds.filter((t) => t !== clubId);
        }
      }
      if (!comp.teamIds.includes(clubId)) comp.teamIds.push(clubId);
    }
  }

  private findClubDraftOrClub(raw: string): string | undefined {
    const k = normKey(raw);
    const d = this.clubDrafts.find((c) => c.id === raw || normKey(c.id) === k || normKey(c.name) === k);
    if (d) return d.id;
    return this.findClub(raw)?.id;
  }

  // ------------------------------------------------ jugadores
  processPlayers(): void {
    interface Draft {
      rec: Rec;
      id: string;
      firstName: string;
      lastName: string;
      commonName: string | null;
      birthDate: string;
      nationalities: string[];
      heightCm: number;
      weightKg: number;
      foot: { left: number; right: number };
      preferredFoot: Player['preferredFoot'];
      positions: PositionRating[];
      clubId: string | null;
      known: Partial<Record<AttrKey, number>>;
      stats: Record<string, number>;
      minutes: number;
      cohort: string | null;
      leagueStrength: number;
      ca?: number;
      pa?: number;
      wage?: number;
      expires?: string;
      releaseClause?: number;
      marketValue?: number;
      condition?: number;
      morale?: number;
      personality?: Player['personality'];
      externalId: string | null;
      estimated: string[];
    }
    const drafts: Draft[] = [];
    const seen = new Map<string, Rec>();
    const nameDob = new Map<string, string>();
    for (const p of this.players.values()) nameDob.set(`${normKey(p.firstName + p.lastName)}|${p.birthDate}`, p.id);
    const statKeys = new Map<string, string>(Object.keys(this.mapping.stats).map((s) => [normKey(s), s]));
    const personalityByLabel = new Map<string, Player['personality']>();
    for (const p of PersonalityType.options) {
      personalityByLabel.set(normKey(p), p);
      personalityByLabel.set(normKey((es.personality as Record<string, string>)[p] ?? p), p);
    }

    for (const rec of this.records.player) {
      this.counts.player.read++;
      const d = rec.data;
      const estimated: string[] = [];
      // Nombre
      let firstName = pick(d, PLAYER_FIELDS.firstName) as string | undefined;
      let lastName = pick(d, PLAYER_FIELDS.lastName) as string | undefined;
      const full = pick(d, PLAYER_FIELDS.fullName) as string | undefined;
      let commonName = (pick(d, PLAYER_FIELDS.commonName) as string | undefined) ?? null;
      if ((!firstName || !lastName) && full) {
        const parts = String(full).trim().split(/\s+/);
        if (parts.length === 1) {
          firstName = firstName ?? (parts[0] as string);
          lastName = lastName ?? (parts[0] as string);
          commonName = commonName ?? (parts[0] as string);
        } else {
          firstName = firstName ?? (parts[0] as string);
          lastName = lastName ?? parts.slice(1).join(' ');
        }
      }
      if (firstName && !lastName) { lastName = String(firstName); commonName = commonName ?? String(firstName); }
      if (!firstName && lastName) { firstName = String(lastName); commonName = commonName ?? String(lastName); }
      let id = this.validId(pick(d, PLAYER_FIELDS.id));
      if (!firstName || !lastName) {
        this.issue({ file: rec.file, row: rec.row, entity: 'player', id, field: 'name', message: 'falta el nombre del jugador' });
        this.counts.player.skipped++;
        continue;
      }
      // Fecha de nacimiento
      let birthDate = this.field(rec, 'player', id, 'birthDate', () => parseDate(pick(d, PLAYER_FIELDS.birthDate)));
      if (!birthDate) {
        const age = this.field(rec, 'player', id, 'age', () => parseInt0(pick(d, PLAYER_FIELDS.age)));
        if (age !== undefined && age >= 14 && age <= 50) {
          birthDate = isoFromParts(this.refYear - age - 1, 12, 31);
        } else {
          birthDate = isoFromParts(this.refYear - 26, 1, 1);
        }
        estimated.push('birthDate');
      }
      if (!id) {
        id = `p_${slug(`${firstName}${lastName}${birthDate}`)}`;
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'id', message: `sin id: se usa "${id}"` });
      }
      const dup = seen.get(id);
      if (dup) {
        this.issue({ file: rec.file, row: rec.row, entity: 'player', id, field: 'id', message: `id duplicado (ya aparece en ${dup.file}, fila ${dup.row}); se descarta esta fila` });
        this.counts.player.skipped++;
        continue;
      }
      seen.set(id, rec);
      const ndKey = `${normKey(String(firstName) + String(lastName))}|${birthDate}`;
      const twin = nameDob.get(ndKey);
      if (twin && twin !== id && !estimated.includes('birthDate')) {
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'name', message: `posible duplicado: mismo nombre y fecha de nacimiento que "${twin}"` });
      }
      nameDob.set(ndKey, id);

      // Club
      const clubRaw = pick(d, PLAYER_FIELDS.clubId);
      let clubId: string | null = null;
      if (clubRaw) {
        clubId = this.findClub(String(clubRaw))?.id ?? null;
        if (!clubId) this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'club', message: `club "${String(clubRaw)}" no encontrado; el jugador queda como agente libre` });
      }
      const club = clubId ? this.clubs.get(clubId) : undefined;

      // Nacionalidades
      const natsRaw = parseList(pick(d, PLAYER_FIELDS.nationalities));
      const nationalities = natsRaw.map((n) => this.resolveNation(n, rec, 'player', id));
      if (nationalities.length === 0) {
        if (club) nationalities.push(club.nationId);
        else nationalities.push(this.resolveNation('Desconocida', rec, 'player', id));
        estimated.push('nationalities');
      }

      // Posiciones
      let positions: PositionRating[] = [];
      const posRaw = pick(d, PLAYER_FIELDS.positions);
      const posMinRaw = pick(d, PLAYER_FIELDS.positionMinutes);
      if (Array.isArray(posRaw) && posRaw.every((x) => x && typeof x === 'object')) {
        for (const x of posRaw as { position?: string; rating?: number }[]) {
          const p = x.position ? parsePosition(String(x.position)) : null;
          if (p) positions.push({ position: p, rating: clamp(Math.round(Number(x.rating ?? 20)), 1, 20) });
        }
      } else if (posMinRaw) {
        const entries = parseList(posMinRaw).map((e) => e.split(/[:=]/));
        const mins: [Position, number][] = [];
        for (const [code, m] of entries) {
          const p = code ? parsePosition(code) : null;
          const n = Number(m);
          if (p && Number.isFinite(n) && n > 0) mins.push([p, n]);
          else this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'positionMinutes', message: `entrada no válida "${entries.map((x) => x.join(':')).join(';')}"` });
        }
        const total = mins.reduce((a, [, m]) => a + m, 0);
        const max = Math.max(0, ...mins.map(([, m]) => m));
        for (const [p, m] of mins) {
          if (m / total < 0.05) continue;
          positions.push({ position: p, rating: clamp(Math.round(10 + (10 * m) / max), 1, 20) });
        }
      } else if (posRaw) {
        const list = parseList(posRaw);
        list.forEach((entry, k) => {
          const m = entry.match(/^([A-Za-z ]+?)\s*(?:[:=(]\s*(\d+)\)?)?$/);
          const p = m ? parsePosition(m[1] as string) : null;
          if (!p) {
            this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'positions', message: `posición desconocida "${entry}"` });
            return;
          }
          const rating = m?.[2] ? clamp(Number(m[2]), 1, 20) : k === 0 ? 20 : 15;
          if (!m?.[2] && k > 0 && !estimated.includes('positions')) estimated.push('positions');
          if (!positions.some((x) => x.position === p)) positions.push({ position: p, rating });
        });
      }
      const hasGkStats = ['save_pct', 'psxg_minus_ga_p90'].some((s) => d.has(normKey(s)));
      if (positions.length === 0) {
        positions = [{ position: hasGkStats ? 'GK' : 'CM', rating: 20 }];
        estimated.push('positions');
        this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'positions', message: `sin posiciones: se asume ${hasGkStats ? 'portero' : 'mediocentro'}` });
      }
      positions.sort((a, b) => b.rating - a.rating);
      // Asegurar una posición natural
      if ((positions[0]?.rating ?? 0) < 20) (positions[0] as PositionRating).rating = 20;
      const main = mainPosition(positions);
      if (positions.length === 1 && main !== 'GK') {
        for (const [p, r] of Object.entries(RELATED_POSITIONS[main]) as [Position, number][]) {
          if (r >= 13) positions.push({ position: p, rating: r - 2 });
        }
        if (positions.length > 1 && !estimated.includes('positions')) estimated.push('positions');
      }

      // Físico
      let height = this.field(rec, 'player', id, 'height', () => parseNumber(pick(d, PLAYER_FIELDS.heightCm)));
      if (height !== undefined && height < 3) height *= 100; // metros
      let weight = this.field(rec, 'player', id, 'weight', () => parseNumber(pick(d, PLAYER_FIELDS.weightKg)));
      if (height === undefined) {
        height = main === 'GK' ? 190 : main === 'CB' ? 187 : main === 'ST' ? 183 : 178;
        estimated.push('heightCm');
      }
      if (weight === undefined) {
        weight = Math.round(height - 105);
        estimated.push('weightKg');
      }

      // Pie
      const footRaw = pick(d, PLAYER_FIELDS.foot);
      const fl = this.field(rec, 'player', id, 'footLeft', () => parseInt0(pick(d, PLAYER_FIELDS.footLeft)));
      const fr = this.field(rec, 'player', id, 'footRight', () => parseInt0(pick(d, PLAYER_FIELDS.footRight)));
      let preferredFoot: Player['preferredFoot'] = 'right';
      if (footRaw) {
        const f = normKey(String(footRaw));
        if (['left', 'l', 'izquierdo', 'izq', 'i', 'zurdo'].includes(f)) preferredFoot = 'left';
        else if (['both', 'either', 'ambos', 'ambidiestro', 'b', 'a'].includes(f)) preferredFoot = 'either';
        else if (['right', 'r', 'derecho', 'der', 'd', 'diestro'].includes(f)) preferredFoot = 'right';
        else this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'foot', message: `pie no reconocido "${String(footRaw)}"; se asume derecho` });
      } else if (fl !== undefined && fr !== undefined) {
        preferredFoot = Math.abs(fl - fr) <= 2 && Math.min(fl, fr) >= 15 ? 'either' : fl > fr ? 'left' : 'right';
      } else {
        estimated.push('preferredFoot');
      }
      const foot = {
        left: clamp(fl ?? (preferredFoot === 'right' ? 8 : preferredFoot === 'either' ? 17 : 20), 1, 20),
        right: clamp(fr ?? (preferredFoot === 'left' ? 8 : preferredFoot === 'either' ? 17 : 20), 1, 20),
      };
      if (fl === undefined || fr === undefined) estimated.push('foot');

      // Atributos explícitos y estadísticas
      const known: Partial<Record<AttrKey, number>> = {};
      const stats: Record<string, number> = {};
      let scaled = false;
      for (const [k, v] of d) {
        const attr = ATTRIBUTE_COLUMN.get(k);
        if (attr) {
          const n = this.field(rec, 'player', id, attr, () => parseNumber(v));
          if (n === undefined) continue;
          let val = n;
          if (val > 20 && val <= 100) { val = val / 5; scaled = true; }
          if (val < 1 || val > 20) {
            this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: attr, message: `atributo fuera de rango (${n}); se estimará` });
            continue;
          }
          known[attr] = clamp(Math.round(val), 1, 20);
          continue;
        }
        const statName = statKeys.get(k) ?? statKeys.get(k.replace(/^stats?/, ''));
        if (statName) {
          const n = this.field(rec, 'player', id, statName, () => parseNumber(v));
          if (n !== undefined) stats[statName] = n;
        }
      }
      if (scaled) this.issue({ severity: 'info', file: rec.file, row: rec.row, entity: 'player', id, field: 'attributes', message: 'atributos en escala 1-100 convertidos a 1-20' });

      let minutes = this.field(rec, 'player', id, 'minutes', () => parseNumber(pick(d, PLAYER_FIELDS.minutes)));
      if (minutes === undefined && Object.keys(stats).length > 0) {
        minutes = this.mapping.settings.fullReliabilityMinutes;
        this.issue({ severity: 'info', file: rec.file, row: rec.row, entity: 'player', id, field: 'minutes', message: 'hay estadísticas pero no minutos: se asume muestra completa' });
      }

      // Cohorte (liga) y fuerza
      const compRaw = pick(d, PLAYER_FIELDS.competitionId);
      const comp = compRaw ? this.findCompetition(String(compRaw)) : clubId ? this.leagueOfClub(clubId) : undefined;
      if (compRaw && !comp) this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'competition', message: `competición "${String(compRaw)}" no encontrada; se usa la liga del club` });
      const cohortComp = comp ?? (clubId ? this.leagueOfClub(clubId) : undefined);
      const explicitStrength = this.field(rec, 'player', id, 'leagueStrength', () => parseNumber(pick(d, PLAYER_FIELDS.leagueStrength)));
      const nationOfComp = cohortComp?.nationId ? this.nations.get(cohortComp.nationId) : club ? this.nations.get(club.nationId) : undefined;
      const leagueStrength = resolveLeagueStrength(explicitStrength ?? cohortComp?.strength, nationOfComp?.leagueStrength, cohortComp?.level, this.mapping);

      const num = (f: string, aliases: readonly string[]) => this.field(rec, 'player', id, f, () => parseNumber(pick(d, aliases)));
      const ca = num('ca', PLAYER_FIELDS.ca);
      const pa = num('pa', PLAYER_FIELDS.pa);
      const weekly = num('wage', PLAYER_FIELDS.wage);
      const annual = num('annualWage', PLAYER_FIELDS.annualWage);
      const persRaw = pick(d, PLAYER_FIELDS.personality);
      const personality = persRaw ? personalityByLabel.get(normKey(String(persRaw))) : undefined;
      if (persRaw && !personality) this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'player', id, field: 'personality', message: `personalidad desconocida "${String(persRaw)}"; se calculará` });

      drafts.push({
        rec, id, firstName: String(firstName), lastName: String(lastName), commonName: commonName ? String(commonName) : null,
        birthDate, nationalities: [...new Set(nationalities)], heightCm: clamp(Math.round(height), 140, 220),
        weightKg: clamp(Math.round(weight), 45, 130), foot, preferredFoot, positions, clubId, known, stats,
        minutes: minutes ?? 0, cohort: cohortComp?.id ?? null, leagueStrength,
        ca: ca === undefined ? undefined : clamp(Math.round(ca), 1, 200),
        pa: pa === undefined ? undefined : clamp(Math.round(pa), 1, 200),
        wage: weekly ?? (annual !== undefined ? annual / 52 : undefined),
        expires: this.field(rec, 'player', id, 'contractExpires', () => parseDate(pick(d, PLAYER_FIELDS.contractExpires))),
        releaseClause: num('releaseClause', PLAYER_FIELDS.releaseClause),
        marketValue: num('marketValue', PLAYER_FIELDS.marketValue),
        condition: num('condition', PLAYER_FIELDS.condition),
        morale: num('morale', PLAYER_FIELDS.morale),
        personality,
        externalId: (pick(d, PLAYER_FIELDS.externalId) as string | undefined) ?? null,
        estimated,
      });
    }

    // Conversión de estadísticas (en bloque, para calcular percentiles por cohorte)
    const statPlayers: StatsPlayer[] = drafts
      .filter((x) => Object.keys(x.stats).length > 0)
      .map((x) => ({
        key: x.id, group: GROUP_OF_POSITION[mainPosition(x.positions)], cohort: x.cohort, leagueStrength: x.leagueStrength,
        minutes: x.minutes, stats: x.stats, heightCm: x.heightCm, weightKg: x.weightKg,
      }));
    const conversions = convertStatsToAttributes(statPlayers, this.mapping);

    for (const x of drafts) {
      const conv = conversions.get(x.id);
      const fromStats = conv?.attributes ?? {};
      if (conv && Object.keys(fromStats).length > 0) this.playersFromStats++;
      if (conv && Object.keys(x.stats).length > 0 && x.minutes < this.mapping.settings.minMinutes) {
        this.issue({ severity: 'info', file: x.rec.file, row: x.rec.row, entity: 'player', id: x.id, field: 'minutes', message: `solo ${x.minutes} minutos: estadísticas insuficientes, atributos estimados` });
      }
      const known: Partial<Record<AttrKey, number>> = { ...fromStats, ...x.known };
      const main = mainPosition(x.positions);
      const group = GROUP_OF_POSITION[main];
      const age = ageAt(x.birthDate, this.startDate);
      const club = x.clubId ? this.clubs.get(x.clubId) : undefined;

      // CA objetivo para rellenar lo que falta
      let target: number;
      const knownVisible = VISIBLE_ATTRS.filter((a) => known[a] !== undefined);
      if (x.ca !== undefined) target = x.ca;
      else if (knownVisible.length >= 6) {
        const w = fullWeights(group);
        let num = 0;
        let den = 0;
        for (const a of knownVisible) { num += (known[a] as number) * (w[a] || 0.2); den += w[a] || 0.2; }
        target = (num / den) * 10;
      } else if (club) {
        target = clubLevel(club.reputation) - 6 - (age < 20 ? (20 - age) * 8 : 0);
      } else target = 70;
      target = clamp(target, 20, 195);

      const gen = generateAttributes(createRng(`import:${x.id}`), { targetCA: target, position: main, age, heightCm: x.heightCm, weightKg: x.weightKg });
      const attributes = {} as FlatAttributes;
      const estAttrs: string[] = [];
      for (const a of [...VISIBLE_ATTRS, ...HIDDEN_ATTRS]) {
        const v = known[a];
        if (v !== undefined) attributes[a] = v;
        else {
          attributes[a] = gen[a];
          estAttrs.push(`attributes.${a}`);
        }
      }
      const estimated = [...x.estimated, ...estAttrs];
      const computed = computeCA(attributes, main);
      const ca = x.ca ?? computed;
      if (x.ca === undefined) estimated.push('ca');
      else if (Math.abs(x.ca - computed) > 20) {
        this.issue({ severity: 'warning', file: x.rec.file, row: x.rec.row, entity: 'player', id: x.id, field: 'ca', message: `CA declarada ${x.ca} muy distinta de la calculada con sus atributos (${computed})` });
      }
      let pa = x.pa;
      if (pa === undefined) {
        pa = estimatePA({ ca, age, leagueStrength: x.leagueStrength, professionalism: attributes.professionalism, determination: attributes.determination, ambition: attributes.ambition });
        estimated.push('pa');
      } else if (pa < ca) {
        this.issue({ severity: 'warning', file: x.rec.file, row: x.rec.row, entity: 'player', id: x.id, field: 'pa', message: `PA (${pa}) menor que CA (${ca}); se iguala` });
        pa = ca;
      }
      const clubRep = club?.reputation ?? 1500;
      let contract: Player['contract'] = null;
      if (x.clubId) {
        const expires = x.expires ?? isoFromParts(this.refYear + 2, 6, 30);
        if (!x.expires) estimated.push('contract.expires');
        const wage = roundMoney(x.wage ?? estimateWage(ca, clubRep, age));
        if (x.wage === undefined) estimated.push('contract.wage');
        const nation = club ? this.nations.get(club.nationId) : undefined;
        let releaseClause = x.releaseClause ?? null;
        if (releaseClause === null && nation?.mandatoryReleaseClause) {
          releaseClause = roundMoney(Math.max(1_000_000, estimateMarketValue({ ca, pa, age, contractYears: 3, clubReputation: clubRep }) * 3));
          estimated.push('contract.releaseClause');
        }
        contract = {
          wage, expires, releaseClause,
          bonuses: { appearance: roundMoney(wage * 0.1), goal: 0, cleanSheet: 0, signing: 0, loyalty: 0 },
          type: age < 19 ? 'youth' : 'full', loanFromClubId: null,
        };
      }
      const years = contract ? Math.max(0, Number(contract.expires.slice(0, 4)) - this.refYear) : 0;
      const marketValue = x.marketValue ?? estimateMarketValue({ ca, pa, age, contractYears: years, clubReputation: clubRep });
      if (x.marketValue === undefined) estimated.push('marketValue');

      const player = {
        id: x.id, firstName: x.firstName, lastName: x.lastName, commonName: x.commonName, birthDate: x.birthDate,
        nationalities: x.nationalities, heightCm: x.heightCm, weightKg: x.weightKg, foot: x.foot,
        preferredFoot: x.preferredFoot, positions: x.positions, clubId: x.clubId, contract, marketValue,
        ca, pa, personality: x.personality ?? derivePersonality(attributes), attributes,
        condition: clamp(x.condition ?? 95, 0, 100), matchSharpness: 60, morale: clamp(x.morale ?? 60, 0, 100),
        history: x.clubId && club ? [{ clubId: x.clubId, clubName: club.name, from: addDays(this.startDate, -365), to: null, fee: 0, loan: false }] : [],
        estimated: [...new Set(estimated)], source: 'imported', externalId: x.externalId,
      };
      const r = PlayerSchema.safeParse(player);
      if (!r.success) {
        this.zodIssues(x.rec, 'player', x.id, r.error.issues);
        this.counts.player.skipped++;
        continue;
      }
      if (this.players.has(x.id) && this.opts.base) this.issue({ severity: 'info', file: x.rec.file, row: x.rec.row, entity: 'player', id: x.id, field: null, message: 'reemplaza al jugador existente con el mismo id' });
      this.players.set(x.id, r.data);
      this.imported.player.add(x.id);
      this.counts.player.imported++;
    }
  }

  // ------------------------------------------------ staff (formato sencillo)
  processStaff(): void {
    const seen = new Map<string, Rec>();
    for (const rec of this.records.staff) {
      this.counts.staff.read++;
      const d = rec.data;
      const id = this.validId(pick(d, ['id', 'staffid']));
      const firstName = pick(d, ['firstname', 'nombre']) as string | undefined;
      const lastName = (pick(d, ['lastname', 'apellido', 'apellidos']) as string | undefined) ?? firstName;
      const roleRaw = normKey(String(pick(d, ['role', 'rol', 'cargo']) ?? ''));
      const role = StaffRole.options.find((r) => normKey(r) === roleRaw);
      if (!id || !firstName || !role) {
        this.issue({ file: rec.file, row: rec.row, entity: 'staff', id, field: !id ? 'id' : !firstName ? 'name' : 'role', message: `faltan datos obligatorios (id, nombre, rol válido: ${StaffRole.options.join(', ')})` });
        this.counts.staff.skipped++;
        continue;
      }
      const dup = seen.get(id);
      if (dup) {
        this.issue({ file: rec.file, row: rec.row, entity: 'staff', id, field: 'id', message: `id duplicado (ya aparece en ${dup.file}, fila ${dup.row})` });
        this.counts.staff.skipped++;
        continue;
      }
      seen.set(id, rec);
      const clubRaw = pick(d, ['clubid', 'club', 'equipo']);
      const club = clubRaw ? this.findClub(String(clubRaw)) : undefined;
      if (clubRaw && !club) this.issue({ severity: 'warning', file: rec.file, row: rec.row, entity: 'staff', id, field: 'club', message: `club "${String(clubRaw)}" no encontrado; queda libre` });
      const estimated: string[] = [];
      const attributes: Record<string, number> = {};
      for (const a of STAFF_ATTRS) {
        const v = this.field(rec, 'staff', id, a, () => parseInt0(d.get(normKey(a)) ?? d.get(`attributes${normKey(a)}`)));
        if (v === undefined) { attributes[a] = 10; estimated.push(`attributes.${a}`); }
        else attributes[a] = clamp(v, 1, 20);
      }
      const nat = pick(d, ['nationality', 'nacionalidad', 'nation', 'pais']);
      const birth = this.field(rec, 'staff', id, 'birthDate', () => parseDate(pick(d, ['birthdate', 'fechanacimiento', 'dob'])));
      if (!birth) estimated.push('birthDate');
      const staff = {
        id, firstName: String(firstName), lastName: String(lastName), birthDate: birth ?? isoFromParts(this.refYear - 45, 1, 1),
        nationality: nat ? this.resolveNation(String(nat), rec, 'staff', id) : club?.nationId ?? this.resolveNation('Desconocida', rec, 'staff', id),
        clubId: club?.id ?? null, role, attributes, regionalKnowledge: [],
        reputation: clamp(this.field(rec, 'staff', id, 'reputation', () => parseInt0(pick(d, ['reputation', 'reputacion']))) ?? (club ? Math.round(club.reputation * 0.8) : 2000), 0, 10000),
        contract: null, estimated, source: 'imported',
      };
      const r = StaffSchema.safeParse(staff);
      if (!r.success) {
        this.zodIssues(rec, 'staff', id, r.error.issues);
        this.counts.staff.skipped++;
        continue;
      }
      this.staff.set(id, r.data);
      this.imported.staff.add(id);
      if (club && !club.staffIds.includes(id)) club.staffIds.push(id);
      this.counts.staff.imported++;
    }
  }

  // ------------------------------------------------ cierre
  finalize(): WorldDatabase {
    // Presupuesto salarial estimado = salarios de la plantilla × 1,1
    const wageByClub = new Map<string, number>();
    for (const p of this.players.values()) if (p.clubId && p.contract) wageByClub.set(p.clubId, (wageByClub.get(p.clubId) ?? 0) + p.contract.wage);
    for (const c of this.clubs.values()) {
      const flagged = c as Club & { _wageEstimate?: boolean };
      if (flagged._wageEstimate) {
        c.finances.wageBudget = roundMoney((wageByClub.get(c.id) ?? 0) * 1.1);
        if (!c.estimated.includes('finances.wageBudget')) c.estimated.push('finances.wageBudget');
        delete flagged._wageEstimate;
      }
      // Rivales inexistentes
      const before = c.rivals.length;
      c.rivals = c.rivals.map((r) => this.findClub(r)?.id).filter((r): r is string => !!r && r !== c.id);
      if (c.rivals.length < before) this.issue({ severity: 'warning', file: '-', row: null, entity: 'club', id: c.id, field: 'rivals', message: 'algún rival no existe y se ha eliminado' });
    }
    // Objetivos de la directiva para clubes importados sin objetivos
    for (const id of this.imported.club) {
      const c = this.clubs.get(id);
      if (!c || c.boardObjectives.length > 0) continue;
      const league = this.leagueOfClub(id);
      if (!league) continue;
      const ranked = league.teamIds.map((t) => this.clubs.get(t)).filter((x): x is Club => !!x).sort((a, b) => b.reputation - a.reputation);
      const rank = ranked.findIndex((x) => x.id === id) + 1;
      const n = ranked.length;
      c.boardObjectives = [
        rank <= 1 ? { type: 'winLeague', competitionId: league.id, target: 1, importance: 'critical' }
          : rank <= Math.ceil(n * 0.25) ? { type: 'leaguePosition', competitionId: league.id, target: Math.ceil(n * 0.25), importance: 'high' }
          : rank <= Math.ceil(n * 0.6) ? { type: 'leaguePosition', competitionId: league.id, target: Math.ceil(n * 0.5), importance: 'medium' }
          : { type: 'avoidRelegation', competitionId: league.id, target: Math.max(1, n - 3), importance: 'high' },
        { type: 'balanceBudget', competitionId: null, target: null, importance: 'medium' },
      ];
      c.estimated.push('boardObjectives');
    }

    if (this.opts.fillSquads) this.fill();

    const db: WorldDatabase = {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        name: this.opts.name ?? 'Base de datos importada',
        source: this.opts.base ? 'mixed' : 'imported',
        seed: this.opts.base?.meta.seed ?? null,
        createdAt: new Date(0).toISOString(), // determinista; la CLI/UI pone la fecha real
        startDate: this.startDate,
        season: this.season,
      },
      nations: [...this.nations.values()],
      clubs: [...this.clubs.values()],
      players: [...this.players.values()],
      staff: [...this.staff.values()],
      competitions: [...this.competitions.values()],
    };
    const r = WorldSchema.safeParse(db);
    if (!r.success) {
      for (const iss of r.error.issues.slice(0, 20)) {
        this.issue({ file: '-', row: null, entity: 'file', id: null, field: iss.path.join('.'), message: `la base resultante no cumple el esquema: ${iss.message}` });
      }
    }
    return db;
  }

  /** Completa plantillas cortas con jugadores ficticios y crea staff donde falte. */
  private fill(): void {
    const minSquad = this.opts.minSquad ?? 22;
    const squads = new Map<string, Player[]>();
    for (const p of this.players.values()) if (p.clubId) (squads.get(p.clubId) ?? squads.set(p.clubId, []).get(p.clubId))!.push(p);
    let seq = 0;
    const nations = [...this.nations.values()];
    for (const club of this.clubs.values()) {
      const squad = squads.get(club.id) ?? [];
      const rng = createRng(`fill:${club.id}`);
      const style = NAME_STYLES.iberico!;
      if (squad.length < minSquad) {
        const have = new Map<string, number>();
        for (const p of squad) {
          const pos = mainPosition(p.positions);
          have.set(pos, (have.get(pos) ?? 0) + 1);
        }
        const needed: (typeof SQUAD_TEMPLATE)[number][] = [];
        const tmplCount = new Map<string, number>();
        for (const slot of SQUAD_TEMPLATE) {
          const used = tmplCount.get(slot[0]) ?? 0;
          tmplCount.set(slot[0], used + 1);
          if (used >= (have.get(slot[0]) ?? 0)) needed.push(slot);
        }
        const missing = minSquad - squad.length;
        const level = clubLevel(club.reputation);
        const nation = this.nations.get(club.nationId);
        for (const [position, tier] of needed.slice(0, missing)) {
          let id: string;
          do { id = `pg_${club.id}_${++seq}`.slice(0, 64); } while (this.players.has(id));
          const p = generatePlayer(rng.fork(id), {
            id, position, targetCA: clamp(level + TIER_OFFSET[tier] - 5 + rng.normal(0, 6), 25, 190), age: ageForTier(rng, tier),
            refDate: this.startDate, nationId: club.nationId, style, clubId: club.id, clubName: club.name,
            clubReputation: club.reputation, mandatoryReleaseClause: nation?.mandatoryReleaseClause ?? false, youth: tier === 'youth',
          });
          p.estimated = ['generatedFill'];
          this.players.set(id, p);
          this.generatedFill++;
        }
        this.issue({ severity: 'info', file: '-', row: null, entity: 'club', id: club.id, field: 'squad', message: `plantilla completada con ${Math.min(missing, needed.length)} jugadores ficticios` });
      }
      if (club.staffIds.length === 0) {
        let sseq = 0;
        const staff = generateClubStaff(rng, club, nations, style, this.refYear, () => `sg_${club.id}_${++sseq}`.slice(0, 64));
        for (const s of staff) { s.estimated = ['generatedFill']; this.staff.set(s.id, s); }
        club.staffIds = staff.map((s) => s.id);
      }
    }
  }
}

/** Importa uno o varios archivos y devuelve la base de datos y el informe. */
export function importDatabase(files: readonly ImportFile[], opts: ImportOptions = {}): ImportResult {
  const imp = new Importer(opts);
  for (const f of files) imp.readFile(f);
  imp.processNations();
  imp.processClubs();
  // Las competiciones necesitan conocer los clubes (borradores) y los clubes necesitan su liga
  imp.processCompetitions();
  imp.finalizeClubs();
  imp.processPlayers();
  imp.processStaff();
  const database = imp.finalize();
  const playersEstimated = database.players.filter((p) => imp.imported.player.has(p.id) && p.estimated.length > 0).length;
  return {
    database,
    issues: imp.issues,
    counts: imp.counts,
    playersEstimated,
    playersFromStats: imp.playersFromStats,
    generatedFill: imp.generatedFill,
    errorCount: imp.issues.filter((i) => i.severity === 'error').length,
    warningCount: imp.issues.filter((i) => i.severity === 'warning').length,
  };
}
