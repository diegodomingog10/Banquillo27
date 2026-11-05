import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { continueGame, indexes, newGame, playUserMatch, resolveMessage, type GameState } from '../src/engine/game';
import { ensureDefaults, resolveUserLineup, setUserLineup, setUserTactic } from '../src/engine/manager';
import { clubView, opponentAnalysis, playerProfile, search, squadTable, tacticsView } from '../src/engine/profileViews';
import { tacticFromFormation } from '../src/engine/tactics';

const world = generateWorld({ seed: 77, nations: 1 });
const fresh = () => newGame({ world, userClubId: world.clubs[3]!.id, manager: { firstName: 'Ana', lastName: 'Ruiz', nationality: null }, seed: 9 });

describe('gestión del equipo del usuario', () => {
  it('la alineación elegida se respeta y el asistente cubre a los no disponibles', () => {
    const s = fresh();
    const squad = indexes(s).squads.get(s.userClubId)!;
    const auto = resolveUserLineup(s);
    expect(auto.starting).toHaveLength(11);
    const reserve = squad.find((p) => !auto.starting.includes(p.id) && p.positions[0]!.position !== 'GK')!;
    const custom = auto.starting.slice();
    custom[10] = reserve.id;
    setUserLineup(s, { starting: custom, bench: auto.bench });
    expect(resolveUserLineup(s).starting[10]).toBe(reserve.id);
    // lesionado: se sustituye y se informa
    reserve.injury = { type: 'knee', severity: 'moderate', startDate: s.date, daysOut: 20, daysRemaining: 20 };
    const r = resolveUserLineup(s);
    expect(r.starting).not.toContain(reserve.id);
    expect(r.replaced).toContain(reserve.id);
    expect(new Set(r.starting).size).toBe(11);
    expect(() => setUserLineup(s, { starting: [reserve.id, reserve.id], bench: [] })).toThrow();
  });

  it('cambiar de sistema cuesta familiaridad y reubica a los titulares', () => {
    const s = fresh();
    s.tacticFamiliarity = 90;
    const before = resolveUserLineup(s).starting;
    const next = tacticFromFormation(s.userTactic.formation === '3-5-2' ? '4-4-2' : '3-5-2');
    setUserTactic(s, next);
    expect(s.tacticFamiliarity).toBeLessThanOrEqual(55);
    const after = resolveUserLineup(s).starting;
    expect(after.filter((id) => before.includes(id)).length).toBeGreaterThanOrEqual(9);
    // un ajuste de instrucciones cuesta poco
    const fam = s.tacticFamiliarity;
    setUserTactic(s, { ...s.userTactic, instructions: { ...s.userTactic.instructions, tempo: 5 } });
    expect(s.tacticFamiliarity).toBe(Math.max(40, fam - 2));
  });

  it('la familiaridad crece con los días y los partidos, y el motor usa tu once', () => {
    const s = fresh();
    s.tacticFamiliarity = 40;
    for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok');
    let r = continueGame(s);
    while (r.stop !== 'userMatch') { for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok'); r = continueGame(s); }
    const lineup = resolveUserLineup(s).starting;
    const { fixture } = playUserMatch(s);
    expect(s.tacticFamiliarity).toBeGreaterThan(45);
    const match = s.userMatches[fixture.id]!;
    const side = fixture.homeId === s.userClubId ? 'home' : 'away';
    expect(match.lineups![side].starting.map((l) => l.playerId).sort()).toEqual(lineup.slice().sort());
  });

  it('vistas de la Fase 4: perfil, plantilla, tácticas, rival, buscador y club', () => {
    const s = fresh();
    const squad = indexes(s).squads.get(s.userClubId)!;
    const prof = playerProfile(s, squad[0]!.id)!;
    expect(prof.radar).toHaveLength(8);
    expect(prof.radarAverage.values).toHaveLength(8);
    expect(prof.report.text.length).toBeGreaterThan(20);
    expect(prof.caStars).toBeGreaterThan(0);
    expect(prof.caStars).toBeLessThanOrEqual(5);
    const rows = squadTable(s);
    expect(rows).toHaveLength(squad.length);
    expect(rows.filter((r) => r.inLineup)).toHaveLength(11);
    const tv = tacticsView(s);
    expect(tv.players[0]!.fit).toHaveLength(11);
    const opp = opponentAnalysis(s, world.clubs[5]!.id)!;
    expect(opp.keyPlayers.length).toBeGreaterThan(0);
    expect(opp.played).toBe(0);
    const q = squad[0]!.lastName.slice(0, 4);
    expect(search(s, q).players.some((p) => p.id === squad[0]!.id)).toBe(true);
    expect(search(s, 'tacti').screens.map((x) => x.id)).toContain('tactics');
    const club = clubView(s, s.userClubId)!;
    expect(club.isUser).toBe(true);
    expect(club.position).toBeNull();
  });

  it('las partidas antiguas reciben los campos nuevos', () => {
    const s = fresh() as Partial<GameState> & GameState;
    delete (s as Partial<GameState>).ui;
    delete (s as Partial<GameState>).userLineup;
    delete (s as Partial<GameState>).tacticFamiliarity;
    ensureDefaults(s);
    expect(s.ui.dashboard.length).toBeGreaterThanOrEqual(7);
    expect(s.userLineup).toBeNull();
    expect(s.tacticFamiliarity).toBe(75);
  });
});
