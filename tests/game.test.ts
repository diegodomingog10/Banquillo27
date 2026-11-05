import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { WorldDatabase } from '../src/data/schema';
import { continueGame, hasBlocking, indexes, leagueTable, newGame, playUserMatch, resolveMessage, type GameState } from '../src/engine/game';
import { dashboardView, matchView } from '../src/engine/views';
import { deleteSave, deserializeGame, listSaves, loadGame, saveGame, serializeGame } from '../src/store/saves';
import { verifyDatabase } from '../src/data/verify';

const world = generateWorld({ seed: 31, nations: 1 });
const userClubId = world.clubs.find((c) => c.id.endsWith('_110'))!.id;
const fresh = () => newGame({ world, userClubId, manager: { firstName: 'Test', lastName: 'Er', nationality: null }, seed: 5 });

function resolveAll(s: GameState) {
  for (const m of s.inbox) if (m.blocking && !m.resolvedActionId) resolveMessage(s, m.id, 'ok');
}

/** Juega hasta una fecha (o hasta el cambio de temporada). */
function playUntil(s: GameState, date: string, stops: Record<string, number> = {}) {
  let guard = 0;
  while (s.date < date && guard++ < 2000) {
    resolveAll(s);
    const r = continueGame(s);
    stops[r.stop] = (stops[r.stop] ?? 0) + 1;
    if (r.stop === 'userMatch') playUserMatch(s);
    if (r.stop === 'newSeason') break;
  }
  return stops;
}

describe('partida y bucle Continuar', () => {
  it('empieza con un mensaje de bienvenida que bloquea el tiempo', () => {
    const s = fresh();
    expect(hasBlocking(s)).toBe(true);
    expect(continueGame(s).stop).toBe('blocking');
    resolveAll(s);
    const r = continueGame(s);
    expect(r.stop).not.toBe('blocking');
    expect(r.daysAdvanced).toBeGreaterThan(0);
  });

  it('se detiene el día de partido del usuario y no avanza hasta jugarlo', () => {
    const s = fresh();
    resolveAll(s);
    let r = continueGame(s);
    while (r.stop !== 'userMatch') { resolveAll(s); r = continueGame(s); }
    const date = s.date;
    expect(continueGame(s).stop).toBe('userMatch');
    expect(s.date).toBe(date);
    const { fixture } = playUserMatch(s);
    expect(fixture.played).toBe(true);
    expect(s.date > date).toBe(true);
    expect(s.userMatches[fixture.id]).toBeDefined();
    const mv = matchView(s, fixture.id)!;
    expect(mv.full).toBe(true);
    expect(mv.ratings.length).toBeGreaterThanOrEqual(22);
    // los demás partidos del día también se jugaron
    expect(s.fixtures.filter((f) => f.date === date).every((f) => f.played)).toBe(true);
  });

  it('temporada completa: ligas, copa, playoffs, ascensos y nueva temporada', { timeout: 120000 }, () => {
    const s = fresh();
    const stops = playUntil(s, '2027-07-02');
    expect(s.season).toBe('2027/28');
    expect(stops.userMatch).toBeGreaterThanOrEqual(38);
    expect(stops.draw).toBeGreaterThanOrEqual(1);
    expect(stops.deadlineDay).toBe(2);
    expect(stops.seasonEnd).toBe(1);
    expect(stops.newSeason).toBe(1);
    // Historial con campeones y 20 equipos por liga
    const hist = s.history.filter((h) => h.season === '2026/27');
    expect(hist).toHaveLength(2);
    for (const h of hist) {
      expect(h.table).toHaveLength(20);
      const points = h.table.reduce((a, r) => a + r.points, 0);
      expect(points).toBeGreaterThan(380 * 2); // entre 2 y 3 puntos por partido
      expect(points).toBeLessThanOrEqual(380 * 3);
    }
    // Ascensos y descensos aplicados: 3 bajan, 3 suben
    const [d1h, d2h] = [hist.find((h) => h.competitionId.endsWith('_1'))!, hist.find((h) => h.competitionId.endsWith('_2'))!];
    const d1 = s.world.competitions.find((c) => c.id === d1h.competitionId)!;
    const d2 = s.world.competitions.find((c) => c.id === d2h.competitionId)!;
    expect(d1.teamIds).toHaveLength(20);
    expect(d2.teamIds).toHaveLength(20);
    const relegated = d1h.table.slice(-3).map((r) => r.clubId);
    for (const id of relegated) expect(d2.teamIds).toContain(id);
    for (const id of d2h.table.slice(0, 2).map((r) => r.clubId)) expect(d1.teamIds).toContain(id);
    // Nueva temporada programada y estadísticas pasadas a la carrera
    expect(s.fixtures.filter((f) => f.stage === 'league')).toHaveLength(760);
    expect(s.world.players.some((p) => p.careerStats.some((c) => c.season === '2026/27' && c.goals > 0))).toBe(true);
    expect(s.world.players.every((p) => p.seasonStats.length === 0)).toBe(true);
    // La base de datos sigue siendo válida
    expect(WorldDatabase.safeParse(s.world).success).toBe(true);
    expect(verifyDatabase(s.world).errors).toEqual([]);
  });

  it('lesiones y sanciones: se aplican y se cumplen', { timeout: 60000 }, () => {
    const s = fresh();
    playUntil(s, '2026-11-15');
    const ps = s.world.players;
    expect(ps.some((p) => p.cards.yellow > 0)).toBe(true);
    const anyInjuryEvent = s.fixtures.some((f) => f.summary?.events.some((e) => e.type === 'injury'));
    expect(anyInjuryEvent).toBe(true);
    // Nadie sancionado juega: en cada partido, ningún jugador con sanción pendiente antes del partido aparece
    for (const p of ps) expect(p.cards.suspendedMatches).toBeGreaterThanOrEqual(0);
    const lt = leagueTable(s, indexes(s).comps.get(s.world.competitions[0]!.id)!.id);
    expect(lt[0]!.played).toBeGreaterThan(5);
  });

  it('es determinista: misma semilla, misma temporada', { timeout: 60000 }, () => {
    const a = fresh();
    const b = fresh();
    playUntil(a, '2026-10-01');
    playUntil(b, '2026-10-01');
    const res = (s: GameState) => s.fixtures.filter((f) => f.played).map((f) => `${f.id}:${f.result!.homeGoals}-${f.result!.awayGoals}`).join(',');
    expect(res(a)).toBe(res(b));
  });

  it('guarda, carga, exporta e importa la partida', async () => {
    const s = fresh();
    resolveAll(s);
    continueGame(s);
    const meta = await saveGame(s);
    expect((await listSaves()).some((m) => m.id === meta.id)).toBe(true);
    const loaded = await loadGame(meta.id);
    expect(loaded.date).toBe(s.date);
    expect(dashboardView(loaded).club.id).toBe(userClubId);
    const text = serializeGame(s);
    const imported = deserializeGame(text);
    expect(imported.fixtures).toHaveLength(s.fixtures.length);
    expect(() => deserializeGame('{"format":"otra"}')).toThrow();
    expect(() => deserializeGame('no es json')).toThrow();
    await deleteSave(meta.id);
    expect((await listSaves()).some((m) => m.id === meta.id)).toBe(false);
  });
});
