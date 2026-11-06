/**
 * Completa la base real importada con los torneos continentales y sus plazas.
 *
 * Uso: npx tsx scripts/real/finalize.ts data/real/world-fc27.json
 *
 * - Liga de Campeones (32) y Liga Europa (32) con las ligas europeas de primera.
 * - Copa Libertadores (32): equipos argentinos por plaza de liga más los clubes
 *   sudamericanos que EA incluye sin liga (juegan solo el torneo).
 * La primera temporada las plazas se reparten por nivel del club; después, por la
 * clasificación final de cada liga (`continentalSpots`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { roundMoney } from '../../src/data/ability';
import type { Competition, WorldDatabase } from '../../src/data/schema';
import { WorldDatabase as WorldSchema } from '../../src/data/schema';
import { verifyDatabase } from '../../src/data/verify';

const path = process.argv[2] ?? 'data/real/world-fc27.json';
const db = JSON.parse(readFileSync(path, 'utf8')) as WorldDatabase;
const clubs = new Map(db.clubs.map((c) => [c.id, c]));
const comps = new Map(db.competitions.map((c) => [c.id, c]));
const nationName = new Map(db.nations.map((n) => [n.id, n.name]));

// Plazas por liga: [Liga de Campeones, Liga Europa]
const EUROPE: Record<string, [number, number]> = {
  lg_premier_league: [4, 3], lg_laliga_ea_sports: [4, 3], lg_serie_a_enilive: [4, 3], lg_bundesliga: [4, 3],
  lg_ligue_1_mcdonalds: [3, 3], lg_liga_portugal: [2, 2], lg_eredivisie: [2, 2], lg_1a_pro_league: [2, 2],
  lg_trendyol_super_lig: [2, 2], lg_scottish_premiership: [1, 2], lg_o_bundesliga: [1, 1], lg_brack_super_league: [1, 1],
  lg_metropolitan_division: [1, 1], lg_eliteserien: [1, 1], lg_allsvenskan: [0, 1], lg_ekstraklasa: [0, 1], lg_superliga: [0, 1],
};
const SOUTH_AMERICA = new Set(['Argentina', 'Brazil', 'Uruguay', 'Paraguay', 'Chile', 'Colombia', 'Ecuador', 'Peru', 'Bolivia', 'Venezuela']);

const byRep = (ids: string[]) => ids.slice().sort((a, b) => (clubs.get(b)?.reputation ?? 0) - (clubs.get(a)?.reputation ?? 0));

function continental(id: string, name: string, shortName: string, teams: string[], rep: number, money: number, continent: string): Competition {
  return {
    id, name, shortName, nationId: null, continent, format: 'groupCup', level: 0, reputation: rep, strength: null,
    teamIds: teams,
    rules: {
      pointsForWin: 3, pointsForDraw: 1, roundRobinLegs: 2,
      tiebreakers: ['points', 'headToHeadPoints', 'headToHeadGoalDifference', 'goalDifference', 'goalsFor'],
      knockoutLegs: 2, finalLegs: 1, extraTime: true, penalties: true, awayGoalsRule: false,
      groups: { count: Math.max(1, Math.floor(teams.length / 4)), size: 4, qualifiersPerGroup: 2, avoidSameNation: true },
      maxSubstitutions: 5, benchSize: 12, maxForeignPlayers: null,
    },
    schedule: { startDate: '2026-09-15', endDate: '2027-05-29', preferredWeekday: 2, breaks: [] },
    prizes: {
      perWin: roundMoney(money * 0.1), perDraw: roundMoney(money * 0.033), byPosition: [],
      byRound: [money, money * 1.5, money * 2.5, money * 4, money * 7].map(roundMoney), tvPerTeam: roundMoney(money * 0.8),
    },
    promotion: null,
    continentalSpots: [],
    estimated: [],
    source: 'imported',
  } as Competition;
}

// Quitar torneos continentales previos (si se vuelve a ejecutar)
db.competitions = db.competitions.filter((c) => c.format !== 'groupCup');

const ucl: string[] = [];
const uel: string[] = [];
for (const [lid, [a, b]] of Object.entries(EUROPE)) {
  const league = comps.get(lid);
  if (!league) { console.warn(`Liga no encontrada: ${lid}`); continue; }
  const order = byRep(league.teamIds);
  ucl.push(...order.slice(0, a));
  uel.push(...order.slice(a, a + b));
  league.continentalSpots = [
    ...(a ? [{ competitionId: 'c_ucl', positions: Array.from({ length: a }, (_, k) => k + 1) }] : []),
    ...(b ? [{ competitionId: 'c_uel', positions: Array.from({ length: b }, (_, k) => a + k + 1) }] : []),
  ];
}
// Libertadores: 6 argentinos + los sudamericanos sin liga (los mejores)
const arg = comps.get('lg_lpf');
const argTeams = arg ? byRep(arg.teamIds).slice(0, 6) : [];
if (arg) arg.continentalSpots = [{ competitionId: 'c_lib', positions: [1, 2, 3, 4, 5, 6] }];
const inLeague = new Set(db.competitions.filter((c) => c.format === 'league').flatMap((c) => c.teamIds));
const freeSA = byRep(db.clubs.filter((c) => !inLeague.has(c.id) && SOUTH_AMERICA.has(nationName.get(c.nationId) ?? '')).map((c) => c.id)).slice(0, 32 - argTeams.length);
const lib = [...argTeams, ...freeSA];

db.competitions.push(continental('c_ucl', 'Liga de Campeones', 'Champions', ucl, 9800, 4_000_000, 'Europa'));
db.competitions.push(continental('c_uel', 'Liga Europa', 'Europa League', uel, 8000, 1_200_000, 'Europa'));
if (lib.length >= 8) db.competitions.push(continental('c_lib', 'Copa Libertadores', 'Libertadores', lib.slice(0, Math.floor(lib.length / 4) * 4), 7500, 900_000, 'América del Sur'));

// Ligas muy grandes (MLS, Argentina): una sola vuelta, como sus formatos reales de temporada regular
for (const c of db.competitions) if (c.format === 'league' && c.teamIds.length >= 26) c.rules.roundRobinLegs = 1;

const parsed = WorldSchema.parse(db);
const v = verifyDatabase(parsed);
writeFileSync(path, JSON.stringify(parsed));
console.log(`Liga de Campeones: ${ucl.length} · Liga Europa: ${uel.length} · Libertadores: ${lib.length >= 8 ? Math.floor(lib.length / 4) * 4 : 0}`);
console.log(`Verificación: ${v.errors.length} errores, ${v.warnings.length} avisos`);
for (const e of v.errors.slice(0, 20)) console.log(`  [error] ${e.entity} ${e.id ?? ''} ${e.field ?? ''}: ${e.message}`);
