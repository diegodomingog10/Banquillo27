import { describe, expect, it } from 'vitest';
import { logistic } from '../src/engine/engineConfig';
import { MatchSimulation, simulateMatch, type MatchInput, type MatchTeamInput } from '../src/engine/matchEngine';
import { createRng } from '../src/engine/rng';
import { FORMATION_IDS, tacticFromFormation } from '../src/engine/tactics';
import { autoLineup } from '../src/engine/lineup';
import { generateSquad } from '../src/data/generator/generateSquad';
import { Match } from '../src/data/schema';

const rng = createRng(77);
const team = (id: string, level = 120, formation = '4-4-2'): MatchTeamInput => ({
  clubId: id, name: id, reputation: 5000,
  squad: generateSquad(rng.fork(id), { clubId: id, level }),
  tactic: tacticFromFormation(formation),
});
const TEAMS = Array.from({ length: 12 }, (_, i) => team(`t${i}`, 120, FORMATION_IDS[i % FORMATION_IDS.length]));
const ctx = (i: number, extra: Partial<MatchInput['context']> = {}): MatchInput['context'] => ({
  matchId: `m${i}`, competitionId: 'c', season: '2026/27', round: '1', date: '2026-08-15', ...extra,
});
const play = (i: number, extra: Partial<MatchInput> = {}) =>
  simulateMatch({ seed: 1000 + i, home: TEAMS[i % 12]!, away: TEAMS[(i * 5 + 1) % 12 === i % 12 ? (i + 1) % 12 : (i * 5 + 1) % 12]!, context: ctx(i), detail: 'fast', ...extra });

const SAMPLE = Array.from({ length: 150 }, (_, i) => play(i));

describe('probabilidad logística', () => {
  it('está acotada y es monótona', () => {
    expect(logistic(10, 10, 5)).toBeCloseTo(0.5);
    expect(logistic(20, 1, 0.1)).toBe(0.99);
    expect(logistic(1, 20, 0.1)).toBe(0.01);
    expect(logistic(12, 10, 5)).toBeGreaterThan(logistic(11, 10, 5));
    expect(logistic(10, 10, 5, 2)).toBeGreaterThan(0.85);
  });
});

describe('motor de partido', () => {
  it('es determinista con la semilla y el modo rápido da el mismo resultado', () => {
    const a = play(3, { detail: 'full' });
    const b = play(3, { detail: 'full' });
    const c = play(3, { detail: 'fast' });
    expect(JSON.stringify(a.match)).toBe(JSON.stringify(b.match));
    expect(c.match.result).toEqual(a.match.result);
    expect(c.match.events).toEqual(a.match.events);
    expect(a.replay.length).toBeGreaterThan(300);
    expect(c.replay).toHaveLength(0);
    const d = play(3, { seed: 99999 });
    expect(JSON.stringify(d.match.events)).not.toBe(JSON.stringify(a.match.events));
  });

  it('produce un Match válido y estadísticas coherentes', () => {
    for (const r of SAMPLE) {
      expect(Match.safeParse(r.match).success).toBe(true);
      const m = r.match;
      const goalsH = m.events.filter((e) => e.type === 'goal' && e.teamId === m.homeId && e.period <= 4).length;
      const goalsA = m.events.filter((e) => e.type === 'goal' && e.teamId === m.awayId && e.period <= 4).length;
      expect(goalsH).toBe(m.result!.homeGoals);
      expect(goalsA).toBe(m.result!.awayGoals);
      for (const s of [m.stats!.home, m.stats!.away]) {
        expect(s.shots).toBeGreaterThanOrEqual(s.shotsOnTarget);
        expect(s.shotsOnTarget).toBeGreaterThanOrEqual(s.goals);
        expect(s.passesCompleted).toBeLessThanOrEqual(s.passes);
      }
      expect(m.stats!.home.possession + m.stats!.away.possession).toBe(100);
      for (const x of m.ratings) {
        expect(x.rating).toBeGreaterThanOrEqual(1);
        expect(x.rating).toBeLessThanOrEqual(10);
      }
      for (const e of m.events) {
        if (e.x !== null) { expect(e.x).toBeGreaterThanOrEqual(0); expect(e.x).toBeLessThanOrEqual(1); }
        expect(e.minute).toBeLessThanOrEqual(120);
      }
      for (const ps of Object.values(r.playerStats)) {
        expect(ps.minutes).toBeGreaterThanOrEqual(0);
        expect(ps.minutes).toBeLessThanOrEqual(90);
      }
      expect(r.phases).toBeGreaterThanOrEqual(150);
      expect(r.phases).toBeLessThanOrEqual(250);
      expect(m.playerOfMatchId).not.toBeNull();
    }
  });

  it('las medias quedan en rangos realistas', () => {
    const n = SAMPLE.length;
    const goals = SAMPLE.reduce((a, r) => a + r.match.result!.homeGoals + r.match.result!.awayGoals, 0) / n;
    const shots = SAMPLE.reduce((a, r) => a + r.match.stats!.home.shots + r.match.stats!.away.shots, 0) / n;
    expect(goals).toBeGreaterThan(1.9);
    expect(goals).toBeLessThan(3.4);
    expect(shots).toBeGreaterThan(19);
    expect(shots).toBeLessThan(31);
  });

  it('fatiga: todos pierden condición; poca resistencia y bandas cansan más', () => {
    const base = team('fat', 120, '4-4-2');
    const squad = base.squad.map((p) => ({ ...p, attributes: { ...p.attributes } }));
    const lineup = autoLineup(squad, base.tactic);
    const lb = squad.find((p) => p.id === lineup.starting[1])!; // LB
    const cb = squad.find((p) => p.id === lineup.starting[2])!; // CB
    const lowStam = squad.find((p) => p.id === lineup.starting[3])!; // CB2
    lowStam.attributes.stamina = 3;
    cb.attributes.stamina = 15;
    lb.attributes.stamina = 15;
    let dLb = 0, dCb = 0, dLow = 0;
    for (let i = 0; i < 30; i++) {
      const r = simulateMatch({ seed: i + 5, home: { ...base, squad, lineup, ai: false }, away: TEAMS[i % 12]!, context: ctx(i), detail: 'fast' });
      const st = (id: string) => r.playerStats[id]!;
      for (const ps of Object.values(r.playerStats)) expect(ps.condition).toBeLessThanOrEqual(100);
      if (st(lb.id).minutes < 90 || st(cb.id).minutes < 90 || st(lowStam.id).minutes < 90) continue;
      dLb += 100 - st(lb.id).condition;
      dCb += 100 - st(cb.id).condition;
      dLow += 100 - st(lowStam.id).condition;
    }
    expect(dCb).toBeGreaterThan(0);
    expect(dLb).toBeGreaterThan(dCb);
    expect(dLow).toBeGreaterThan(dCb);
  });

  it('tarjetas: hay amarillas y los expulsados dejan de jugar', () => {
    const yellows = SAMPLE.reduce((a, r) => a + r.match.stats!.home.yellow + r.match.stats!.away.yellow, 0);
    expect(yellows / SAMPLE.length).toBeGreaterThan(1.5);
    let reds = 0;
    for (const r of SAMPLE) {
      const evs = r.match.events;
      evs.forEach((e, i) => {
        if (e.type !== 'red' && e.type !== 'secondYellow') return;
        reds++;
        const later = evs.slice(i + 1).filter((x) => x.playerId === e.playerId && ['goal', 'foul', 'shot', 'save', 'yellow'].includes(x.type));
        expect(later).toHaveLength(0);
        expect(r.playerStats[e.playerId!]!.red).toBe(1);
      });
    }
    expect(reds).toBeGreaterThan(0);
  });

  it('sustituciones: respetan el máximo y los suplentes juegan minutos', () => {
    let total = 0;
    for (const r of SAMPLE) {
      for (const side of [r.match.homeId, r.match.awayId]) {
        const subs = r.match.events.filter((e) => e.type === 'substitution' && e.teamId === side);
        expect(subs.length).toBeLessThanOrEqual(5);
        total += subs.length;
        for (const s of subs) {
          const ps = r.playerStats[s.playerId!]!;
          expect(ps.started).toBe(false);
          expect(r.playerStats[s.otherPlayerId!]!.minutes).toBeLessThanOrEqual(90);
        }
      }
    }
    expect(total / SAMPLE.length).toBeGreaterThan(4);
  });

  it('el equipo claramente mejor gana la mayoría', () => {
    const strong = team('fuerte', 150);
    const weak = team('debil', 105);
    let w = 0;
    for (let i = 0; i < 60; i++) {
      const home = i % 2 === 0;
      const r = simulateMatch({ seed: 50 + i, home: home ? strong : weak, away: home ? weak : strong, context: ctx(i), detail: 'fast' });
      if (r.winner === (home ? 'home' : 'away')) w++;
    }
    expect(w / 60).toBeGreaterThan(0.6);
  });

  it('eliminatorias: siempre hay ganador (prórroga y penaltis)', () => {
    let shootouts = 0;
    for (let i = 0; i < 40; i++) {
      const r = play(i, { context: ctx(i, { decideWinner: true }) });
      expect(r.winner).not.toBeNull();
      if (r.match.result!.penalties) {
        shootouts++;
        expect(r.match.result!.extraTime).toBe(true);
        expect(r.match.result!.penalties.home).not.toBe(r.match.result!.penalties.away);
      }
    }
    expect(shootouts).toBeGreaterThan(0);
  });

  it('la IA que va perdiendo adelanta líneas y sube la mentalidad', () => {
    let reacted = 0;
    let losing = 0;
    for (const r of SAMPLE) {
      const goals70 = (id: string) => r.match.events.filter((e) => e.type === 'goal' && e.teamId === id && e.minute < 60).length;
      const h = goals70(r.match.homeId);
      const a = goals70(r.match.awayId);
      if (h === a) continue;
      losing++;
      const loser = h < a ? r.match.homeId : r.match.awayId;
      if (r.match.events.some((e) => e.type === 'tacticChange' && e.teamId === loser && /mentality:[5-7]/.test(e.detail ?? ''))) reacted++;
    }
    expect(losing).toBeGreaterThan(10);
    expect(reacted / losing).toBeGreaterThan(0.7);
  });

  it('acepta órdenes en directo: cambios, ajustes y gritos', () => {
    const home = { ...TEAMS[0]!, ai: false };
    const sim = new MatchSimulation({ seed: 4, home, away: TEAMS[1]!, context: ctx(1) });
    sim.runToMinute(30);
    const lineup = autoLineup(home.squad, home.tactic);
    const outId = lineup.starting[9]!;
    const inId = lineup.bench.find((id) => id !== lineup.bench[0])!;
    sim.command(0, { type: 'substitution', outId, inId });
    sim.command(0, { type: 'tweak', tweak: 'moreUrgency', active: true });
    sim.command(0, { type: 'shout', shout: 'encourage' });
    sim.step();
    const r = sim.run();
    const sub = r.match.events.find((e) => e.type === 'substitution' && e.teamId === home.clubId);
    expect(sub?.playerId).toBe(inId);
    expect(sub?.minute).toBeGreaterThanOrEqual(30);
    expect(r.match.events.some((e) => e.type === 'tacticChange' && e.detail === 'tweak:moreUrgency:on')).toBe(true);
    expect(r.shouts.some((s) => s.side === 0 && s.shout === 'encourage')).toBe(true);
    expect(r.playerStats[outId]!.minutes).toBeLessThanOrEqual(32);
  });

  it('rendimiento: una jornada de 10 partidos en menos de 1 s', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) play(500 + i);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('la ventaja de campo se nota', () => {
    let h = 0, a = 0;
    for (let i = 0; i < 300; i++) {
      const r = play(2000 + i);
      h += r.match.result!.homeGoals;
      a += r.match.result!.awayGoals;
    }
    expect(h).toBeGreaterThan(a);
  });
});
