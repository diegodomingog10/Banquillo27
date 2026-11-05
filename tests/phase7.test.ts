import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { indexes, newGame, resolveMessage, type GameState } from '../src/engine/game';
import { addDays, ageAt, isoFromParts } from '../src/engine/date';
import { declineCurve, growthCurve, progressionDay } from '../src/engine/progression';
import { coachQuality, medicalDays, recoveryFactor, setIndividualTraining, setTrainingPlan, trainingDay } from '../src/engine/training';
import { addConcern, dressingDay, playerMood, talkToPlayer, teamMeeting } from '../src/engine/dressingRoom';
import { retirements, seasonAwards, youthIntake } from '../src/engine/seasonLife';
import { ensureDefaults } from '../src/engine/manager';

const world = generateWorld({ seed: 21, nations: 1 });
function game(): GameState {
  const s = newGame({ world, userClubId: world.clubs[4]!.id, manager: { firstName: 'Ana', lastName: 'Prueba', nationality: null }, seed: 3 });
  for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok');
  return s;
}
const mondays = (s: GameState, weeks: number, each?: () => void) => {
  let d = s.date;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  for (let i = 0; i < weeks; i++) { s.date = addDays(d, 7 * i); each?.(); progressionDay(s); }
};

describe('progresión', () => {
  it('curvas: crecen los jóvenes y bajan los veteranos', () => {
    expect(growthCurve(18)).toBeGreaterThan(growthCurve(24));
    expect(growthCurve(31)).toBe(0);
    expect(declineCurve(34)).toBeGreaterThan(declineCurve(31));
  });
  it('un joven con margen y minutos mejora; un veterano pierde físico antes que mente', () => {
    const s = game();
    const squad = indexes(s).squads.get(s.userClubId)!;
    const young = squad.slice().sort((a, b) => ageAt(a.birthDate, s.date) - ageAt(b.birthDate, s.date))[0]!;
    young.pa = Math.max(young.pa, young.ca + 50);
    const old = squad.slice().sort((a, b) => ageAt(b.birthDate, s.date) - ageAt(a.birthDate, s.date))[0]!;
    old.birthDate = isoFromParts(Number(s.date.slice(0, 4)) - 35, 1, 1);
    const ca0 = young.ca;
    const phys0 = old.attributes.pace + old.attributes.acceleration + old.attributes.stamina;
    const ment0 = old.attributes.decisions + old.attributes.positioning;
    mondays(s, 52, () => { s.progression.minutes[young.id] = 400; s.progression.minutes[old.id] = 400; });
    expect(young.ca).toBeGreaterThan(ca0 + 3);
    const phys1 = old.attributes.pace + old.attributes.acceleration + old.attributes.stamina;
    const ment1 = old.attributes.decisions + old.attributes.positioning;
    expect(phys0 - phys1).toBeGreaterThan(ment0 - ment1);
    expect(s.progression.changes[young.id]?.length).toBeGreaterThan(0);
  });
  it('el entrenamiento individual de posición enseña una posición nueva', () => {
    const s = game();
    const p = indexes(s).squads.get(s.userClubId)!.find((x) => !x.positions.some((y) => y.position === 'ST') && x.positions[0]!.position !== 'GK')!;
    setIndividualTraining(s, p.id, 'none', 'ST');
    mondays(s, 20);
    expect(p.positions.find((x) => x.position === 'ST')?.rating ?? 0).toBeGreaterThan(0);
  });
});

describe('entrenamiento y lesiones', () => {
  it('la carga alta reduce la recuperación y provoca más lesiones', () => {
    const count = (intensity: 'low' | 'high') => {
      const s = game();
      setTrainingPlan(s, { ...s.training.plan, intensity });
      expect(recoveryFactor(s, s.userClubId)).toBe(intensity === 'high' ? 0.82 : 1.18);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        s.date = addDays(s.date, 1);
        for (const p of indexes(s).squads.get(s.userClubId)!) p.injury = null;
        trainingDay(s, new Set());
        n += indexes(s).squads.get(s.userClubId)!.filter((p) => p.injury).length;
      }
      return n;
    };
    expect(count('high')).toBeGreaterThan(count('low'));
  });
  it('un buen cuerpo médico acorta las lesiones', () => {
    const s = game();
    const q = coachQuality(s, s.userClubId).medical;
    const d = medicalDays(s, s.userClubId, 30);
    expect(d).toBe(Math.max(1, Math.round(30 * (1.18 - q / 55))));
  });
});

describe('vestuario', () => {
  it('sin minutos aparece la preocupación y una promesa incumplida duele', () => {
    const s = game();
    const p = indexes(s).squads.get(s.userClubId)!.find((x) => ageAt(x.birthDate, s.date) >= 22)!;
    s.transfers.roles[p.id] = 'important';
    s.dressing.happiness[p.id] = { concerns: [], share: 0, shortWeeks: 0 };
    let d = s.date;
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    const opp = s.world.clubs.find((c) => c.id !== s.userClubId)!.id;
    const played = (date: string) => s.fixtures.push({ id: `fx${date}`, competitionId: 'x', season: s.season, round: 'md:1', stage: 'league', date: addDays(date, -2), homeId: s.userClubId, awayId: opp, played: true, decideWinner: false, result: { homeGoals: 1, awayGoals: 0, extraTime: false, penalties: null, winnerId: null }, summary: null });
    for (let i = 0; i < 6; i++) { s.date = addDays(d, 7 * i); played(s.date); dressingDay(s); }
    expect(playerMood(s, p).concerns.some((c) => c.kind === 'playingTime')).toBe(true);
    const r = talkToPlayer(s, p.id, 'promiseTime');
    expect(r.result).toBe('good');
    expect(() => talkToPlayer(s, p.id, 'praise')).toThrow();
    const m0 = p.morale;
    for (let i = 6; i < 14; i++) { s.date = addDays(d, 7 * i); played(s.date); dressingDay(s); }
    expect(s.dressing.promises.find((x) => x.playerId === p.id)?.status).toBe('broken');
    expect(p.morale).toBeLessThan(m0);
  });
  it('las reuniones de equipo tienen espera', () => {
    const s = game();
    teamMeeting(s, 'unity');
    expect(() => teamMeeting(s, 'praise')).toThrow();
    const p = indexes(s).squads.get(s.userClubId)![0]!;
    addConcern(s, p.id, 'conflict', 2);
    expect(playerMood(s, p).talks.map((t) => t.id)).toContain('resolveConflict');
  });
});

describe('fin de temporada', () => {
  it('premios, retiradas y canteranos', () => {
    const s = game();
    const ps = s.world.players.filter((p) => p.clubId).slice(0, 60);
    const lg = s.world.competitions.find((c) => c.format === 'league')!;
    for (const p of ps) p.seasonStats.push({ season: s.season, clubId: p.clubId, competitionId: lg.id, apps: 20, starts: 20, minutes: 1800, goals: p.ca % 13, assists: 0, xg: 0, xa: 0, shots: 0, passesCompleted: 0, tackles: 0, yellow: 0, red: 0, cleanSheets: 3, avgRating: 6 + (p.ca % 20) / 10, playerOfMatch: 0 });
    const aw = seasonAwards(s);
    expect(aw.length).toBeGreaterThan(0);
    expect(aw[0]!.playerOfSeason).not.toBeNull();
    const old = s.world.players[0]!;
    old.birthDate = isoFromParts(1980, 1, 1);
    const ids = retirements(s, '2027-07-01');
    expect(ids).toContain(old.id);
    expect(s.world.players.some((p) => p.id === old.id)).toBe(false);
    const n0 = s.world.players.length;
    youthIntake(s, '2027-07-01');
    expect(s.world.players.length).toBeGreaterThan(n0 + s.world.clubs.length);
    expect(s.youthIntake?.ids.length).toBeGreaterThan(0);
  });
  it('las partidas antiguas reciben los sistemas de la Fase 7', () => {
    const s = game();
    const raw = s as unknown as Record<string, unknown>;
    delete raw.training; delete raw.progression; delete raw.dressing; delete raw.awards;
    ensureDefaults(s);
    expect(s.training.plan.intensity).toBe('normal');
    expect(Array.isArray(s.awards)).toBe(true);
  });
});

import { simulateMatch } from '../src/engine/matchEngine';
import { buildMatchInput, invalidate } from '../src/engine/game';
describe('torneos continentales', () => {
  it('se planifican con grupos, eliminatorias y fechas entre semana', () => {
    const w = generateWorld({ seed: 5, nations: 4 });
    const s = newGame({ world: w, userClubId: w.clubs[0]!.id, manager: { firstName: 'A', lastName: 'B', nationality: null }, seed: 1 });
    const cs = Object.values(s.continental);
    expect(cs.length).toBe(2);
    for (const c of cs) {
      expect(c.groups.length).toBeGreaterThanOrEqual(2);
      expect(c.groupDates.length).toBe(6);
      expect(c.rounds.at(-1)!.key).toBe('final');
      for (const d of c.groupDates) expect([2, 4]).toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
    }
  });
  it('la vuelta decide por el global', () => {
    const w = generateWorld({ seed: 5, nations: 1 });
    const s = newGame({ world: w, userClubId: w.clubs[0]!.id, manager: { firstName: 'A', lastName: 'B', nationality: null }, seed: 1 });
    const [a, b] = [w.clubs[1]!.id, w.clubs[2]!.id];
    const leg1 = { id: 'L1', competitionId: 'x', season: s.season, round: 'ko:qf:1', stage: 'continental' as const, date: s.date, homeId: a, awayId: b, played: true, decideWinner: false, result: { homeGoals: 5, awayGoals: 0, extraTime: false, penalties: null, winnerId: null }, summary: null };
    s.fixtures.push(leg1);
    const leg2 = { ...leg1, id: 'L2', round: 'ko:qf:2', homeId: b, awayId: a, played: false, decideWinner: true, result: null, firstLegId: 'L1' };
    s.fixtures.push(leg2);
    invalidate(s);
    const input = buildMatchInput(s, leg2, 'fast');
    expect(input.context.aggregate).toEqual({ home: 0, away: 5 });
    const r = simulateMatch(input);
    const totalB = r.match.result!.homeGoals, totalA = 5 + r.match.result!.awayGoals;
    if (totalA !== totalB) expect(r.winner).toBe(totalA > totalB ? 'away' : 'home');
  });
});
