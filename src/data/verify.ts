/**
 * Verificación de una base de datos completa (generada o importada).
 * Avisa de atributos fuera de rango, referencias rotas, plantillas incompletas e
 * incoherencias entre CA y atributos. No modifica nada.
 */
import { computeCA, mainPosition } from './ability';
import { GROUP_OF_POSITION, type PositionGroup } from './positions';
import { Club, Competition, Nation, Player, Staff, type WorldDatabase } from './schema';
import type { z } from 'zod';

export interface VerifyIssue {
  entity: 'nation' | 'club' | 'player' | 'staff' | 'competition' | 'database';
  id: string | null;
  field: string | null;
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  errors: VerifyIssue[];
  warnings: VerifyIssue[];
  summary: {
    nations: number;
    clubs: number;
    players: number;
    staff: number;
    competitions: number;
    freeAgents: number;
    playersWithEstimatedData: number;
    avgSquadSize: number;
  };
}

export interface VerifyOptions {
  minSquad?: number;
  maxSquad?: number;
  minGoalkeepers?: number;
  /** Diferencia máxima tolerada entre CA declarada y CA calculada. */
  caTolerance?: number;
  /** Límite de incidencias por tipo para no inundar el informe. */
  maxIssues?: number;
}

export function verifyDatabase(db: WorldDatabase, opts: VerifyOptions = {}): VerifyReport {
  const minSquad = opts.minSquad ?? 18;
  const maxSquad = opts.maxSquad ?? 45;
  const minGk = opts.minGoalkeepers ?? 2;
  const caTol = opts.caTolerance ?? 15;
  const maxIssues = opts.maxIssues ?? 5000;
  const errors: VerifyIssue[] = [];
  const warnings: VerifyIssue[] = [];
  const err = (i: VerifyIssue) => { if (errors.length < maxIssues) errors.push(i); };
  const warn = (i: VerifyIssue) => { if (warnings.length < maxIssues) warnings.push(i); };

  // Esquema por entidad
  const check = <T extends z.ZodType>(schema: T, list: readonly unknown[], entity: VerifyIssue['entity']) => {
    for (const item of list) {
      const r = schema.safeParse(item);
      if (!r.success) {
        const id = (item as { id?: string }).id ?? null;
        for (const iss of r.error.issues.slice(0, 5)) {
          err({ entity, id, field: iss.path.join('.'), message: `fuera de rango o inválido: ${iss.message}` });
        }
      }
    }
  };
  check(Nation, db.nations, 'nation');
  check(Club, db.clubs, 'club');
  check(Player, db.players, 'player');
  check(Staff, db.staff, 'staff');
  check(Competition, db.competitions, 'competition');

  // Duplicados
  const dupCheck = (list: readonly { id: string }[], entity: VerifyIssue['entity']) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) err({ entity, id: x.id, field: 'id', message: 'id duplicado' });
      seen.add(x.id);
    }
    return seen;
  };
  const nationIds = dupCheck(db.nations, 'nation');
  const clubIds = dupCheck(db.clubs, 'club');
  dupCheck(db.players, 'player');
  const staffIds = dupCheck(db.staff, 'staff');
  const compIds = dupCheck(db.competitions, 'competition');

  // Referencias
  for (const c of db.clubs) {
    if (!nationIds.has(c.nationId)) err({ entity: 'club', id: c.id, field: 'nationId', message: `nación inexistente ${c.nationId}` });
    for (const r of c.rivals) if (!clubIds.has(r)) warn({ entity: 'club', id: c.id, field: 'rivals', message: `rival inexistente ${r}` });
    for (const s of c.staffIds) if (!staffIds.has(s)) warn({ entity: 'club', id: c.id, field: 'staffIds', message: `staff inexistente ${s}` });
  }
  for (const s of db.staff) {
    if (s.clubId && !clubIds.has(s.clubId)) err({ entity: 'staff', id: s.id, field: 'clubId', message: `club inexistente ${s.clubId}` });
  }
  const leagueOf = new Map<string, string>();
  for (const comp of db.competitions) {
    if (comp.nationId && !nationIds.has(comp.nationId)) err({ entity: 'competition', id: comp.id, field: 'nationId', message: `nación inexistente ${comp.nationId}` });
    for (const t of comp.teamIds) {
      if (!clubIds.has(t)) err({ entity: 'competition', id: comp.id, field: 'teamIds', message: `club inexistente ${t}` });
      if (comp.format === 'league') {
        const prev = leagueOf.get(t);
        if (prev) err({ entity: 'competition', id: comp.id, field: 'teamIds', message: `el club ${t} ya está en la liga ${prev}` });
        leagueOf.set(t, comp.id);
      }
    }
    if (comp.format === 'league' && comp.teamIds.length < 4) warn({ entity: 'competition', id: comp.id, field: 'teamIds', message: `liga con solo ${comp.teamIds.length} equipos` });
    if (comp.format === 'league' && comp.teamIds.length % 2 === 1) warn({ entity: 'competition', id: comp.id, field: 'teamIds', message: 'número impar de equipos: habrá jornada de descanso' });
    for (const s of comp.continentalSpots) if (!compIds.has(s.competitionId)) warn({ entity: 'competition', id: comp.id, field: 'continentalSpots', message: `competición destino inexistente ${s.competitionId}` });
    if (comp.promotion) {
      for (const k of ['upCompetitionId', 'downCompetitionId'] as const) {
        const v = comp.promotion[k];
        if (v && !compIds.has(v)) warn({ entity: 'competition', id: comp.id, field: `promotion.${k}`, message: `competición inexistente ${v}` });
      }
    }
    if (comp.schedule.endDate < comp.schedule.startDate) err({ entity: 'competition', id: comp.id, field: 'schedule', message: 'la fecha de fin es anterior a la de inicio' });
  }
  for (const c of db.clubs) {
    if (!leagueOf.has(c.id)) warn({ entity: 'club', id: c.id, field: null, message: 'el club no pertenece a ninguna liga' });
  }

  // Jugadores y plantillas
  const squads = new Map<string, { total: number; groups: Record<PositionGroup, number> }>();
  let freeAgents = 0;
  let estimatedCount = 0;
  for (const p of db.players) {
    if (p.estimated.length > 0) estimatedCount++;
    for (const n of p.nationalities) if (!nationIds.has(n)) warn({ entity: 'player', id: p.id, field: 'nationalities', message: `nación inexistente ${n}` });
    if (p.pa < p.ca) err({ entity: 'player', id: p.id, field: 'pa', message: `PA (${p.pa}) menor que CA (${p.ca})` });
    const main = mainPosition(p.positions);
    if (p.attributes && typeof p.attributes.passing === 'number') {
      const calc = computeCA(p.attributes, main);
      if (Math.abs(calc - p.ca) > caTol) warn({ entity: 'player', id: p.id, field: 'ca', message: `CA declarada ${p.ca} y calculada ${calc} difieren mucho` });
    }
    if (p.contract && p.contract.expires < db.meta.startDate) warn({ entity: 'player', id: p.id, field: 'contract.expires', message: 'contrato ya vencido en la fecha de inicio' });
    if (!p.clubId) { freeAgents++; continue; }
    if (!clubIds.has(p.clubId)) { err({ entity: 'player', id: p.id, field: 'clubId', message: `club inexistente ${p.clubId}` }); continue; }
    let s = squads.get(p.clubId);
    if (!s) {
      s = { total: 0, groups: { GK: 0, CB: 0, FB: 0, DM: 0, CM: 0, WIDE: 0, AM: 0, ST: 0 } };
      squads.set(p.clubId, s);
    }
    s.total++;
    s.groups[GROUP_OF_POSITION[main]]++;
  }
  let squadSum = 0;
  for (const c of db.clubs) {
    const s = squads.get(c.id);
    const total = s?.total ?? 0;
    squadSum += total;
    if (total < minSquad) warn({ entity: 'club', id: c.id, field: 'squad', message: `plantilla incompleta: ${total} jugadores (mínimo recomendado ${minSquad})` });
    if (total > maxSquad) warn({ entity: 'club', id: c.id, field: 'squad', message: `plantilla excesiva: ${total} jugadores` });
    if ((s?.groups.GK ?? 0) < minGk) warn({ entity: 'club', id: c.id, field: 'squad', message: `solo ${s?.groups.GK ?? 0} porteros` });
    if (s && s.groups.CB + s.groups.FB < 4) warn({ entity: 'club', id: c.id, field: 'squad', message: 'menos de 4 defensas' });
    if (s && s.groups.ST + s.groups.WIDE + s.groups.AM < 3) warn({ entity: 'club', id: c.id, field: 'squad', message: 'menos de 3 atacantes' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      nations: db.nations.length,
      clubs: db.clubs.length,
      players: db.players.length,
      staff: db.staff.length,
      competitions: db.competitions.length,
      freeAgents,
      playersWithEstimatedData: estimatedCount,
      avgSquadSize: db.clubs.length ? squadSum / db.clubs.length : 0,
    },
  };
}
