import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/data/generator/generateWorld';
import { generateSquad } from '../src/data/generator/generateSquad';
import { commentary } from '../src/engine/commentary';
import { continueGame, indexes, newGame, playUserMatch, prepareUserMatch, resolveMessage } from '../src/engine/game';
import { LiveMatch, staffAdvice } from '../src/engine/liveMatch';
import type { MatchInput, MatchTeamInput } from '../src/engine/matchEngine';
import { answerPress, skipPress } from '../src/engine/postMatch';
import { createRng } from '../src/engine/rng';
import { tacticFromFormation } from '../src/engine/tactics';

const rng = createRng(5);
const team = (id: string): MatchTeamInput => ({ clubId: id, name: id, reputation: 5000, squad: generateSquad(rng.fork(id), { clubId: id, level: 120 }), tactic: tacticFromFormation('4-4-2') });
const A = team('a');
const B = team('b');
const input = (seed: number): MatchInput => ({ seed, home: A, away: B, context: { matchId: 'm', competitionId: 'c', season: 's', round: '1', date: '2026-08-15' } });

describe('partido en directo', () => {
  it('es determinista con las mismas órdenes en los mismos momentos', () => {
    const run = () => {
      const lm = new LiveMatch(input(11), 0);
      lm.tick({ phases: 60 });
      lm.command({ type: 'mentality', mentality: 6 });
      lm.command({ type: 'tweak', tweak: 'moreUrgency', active: true });
      lm.tick({ phases: 40 });
      lm.command({ type: 'shout', shout: 'encourage' });
      return lm.result();
    };
    expect(JSON.stringify(run().match)).toBe(JSON.stringify(run().match));
  });

  it('para en el descanso y en los momentos clave; resultado directo llega al final', () => {
    const lm = new LiveMatch(input(3), 0);
    let t = lm.tick({ phases: 400 });
    let guard = 0;
    while (t.pause !== 'halfTime' && guard++ < 20) t = lm.tick({ phases: 400 });
    expect(t.pause).toBe('halfTime');
    expect(t.snapshot.minute).toBeGreaterThanOrEqual(45);
    const k = lm.tick({ untilKey: true });
    expect(k.events.length).toBeGreaterThan(0);
    const end = lm.tick({ toEnd: true });
    expect(end.snapshot.finished).toBe(true);
    expect(end.pause).toBe('fullTime');
  });

  it('la foto en directo es coherente y la narración cubre los goles', () => {
    const lm = new LiveMatch(input(8), 0);
    const all = [];
    let t = lm.tick({ phases: 30 });
    all.push(...t.events);
    expect(t.snapshot.teams[0].players.filter((p) => p.onPitch)).toHaveLength(11);
    expect(t.snapshot.teams[0].stats.possession + t.snapshot.teams[1].stats.possession).toBe(100);
    expect(t.replay.length).toBeGreaterThan(0);
    t = lm.tick({ toEnd: true });
    all.push(...t.events);
    const goals = all.filter((e) => e.type === 'goal').length;
    const lines = commentary(all, { player: () => 'X', team: () => 'Y' });
    expect(lines.filter((l) => l.kind === 'goal')).toHaveLength(goals);
    expect(lines.some((l) => l.kind === 'whistle')).toBe(true);
  });

  it('el cuerpo técnico aconseja según el marcador y el cansancio', () => {
    const lm = new LiveMatch(input(2), 0);
    const snap = lm.tick({ phases: 1 }).snapshot;
    const late = structuredClone(snap);
    late.minute = 75;
    late.teams[1].goals = 1;
    late.teams[0].goals = 0;
    late.teams[0].players.filter((p) => p.onPitch && !p.isGk)[0]!.condition = 55;
    const adv = staffAdvice(late, 0);
    expect(adv.some((a) => a.tweak === 'moreUrgency')).toBe(true);
    expect(adv.some((a) => a.kind === 'sub')).toBe(true);
    late.teams[0].goals = 2;
    late.teams[0].tweaks = ['moreUrgency'];
    expect(staffAdvice(late, 0).some((a) => a.kind === 'tweakOff' && a.tweak === 'moreUrgency')).toBe(true);
  });

  it('los gritos devuelven un resumen del cuerpo técnico', () => {
    const lm = new LiveMatch(input(4), 0);
    lm.tick({ phases: 20 });
    lm.command({ type: 'shout', shout: 'focus' });
    const t = lm.tick({ phases: 2 });
    expect(t.shouts).toHaveLength(1);
    expect(t.shouts[0]!.summary).toMatch(/concentra|discreto|bien|sentado/);
  });
});

describe('post-partido', () => {
  it('el partido en directo se aplica a la partida y hay rueda de prensa con efectos', () => {
    const world = generateWorld({ seed: 21, nations: 1 });
    const s = newGame({ world, userClubId: world.clubs[4]!.id, manager: { firstName: 'A', lastName: 'B', nationality: null }, seed: 1 });
    for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok');
    let r = continueGame(s);
    while (r.stop !== 'userMatch') { for (const m of s.inbox) if (m.blocking) resolveMessage(s, m.id, 'ok'); r = continueGame(s); }
    const prep = prepareUserMatch(s);
    const lm = new LiveMatch(prep.input, prep.userSide);
    lm.tick({ phases: 50 });
    lm.command({ type: 'mentality', mentality: 7 });
    const result = lm.result();
    const { fixture } = playUserMatch(s, result);
    expect(fixture.played).toBe(true);
    expect(fixture.result!.homeGoals).toBe(result.match.result!.homeGoals);
    expect(s.userMatches[fixture.id]!.events.some((e) => e.type === 'tacticChange' && e.detail === 'mentality:7')).toBe(true);
    const pm = s.postMatch!;
    expect(pm.fixtureId).toBe(fixture.id);
    expect(pm.report.length).toBeGreaterThan(0);
    expect(pm.press.length).toBeGreaterThanOrEqual(2);
    const squad = indexes(s).squads.get(s.userClubId)!;
    const before = squad.reduce((a, p) => a + p.morale, 0);
    const q = pm.press[0]!;
    const best = q.options.slice().sort((a, b) => b.team - a.team)[0]!;
    answerPress(s, q.id, best.id);
    expect(squad.reduce((a, p) => a + p.morale, 0)).toBeGreaterThan(before);
    expect(s.news[0]!.text).toBe(best.headline);
    skipPress(s);
    expect(s.postMatch!.pressDone).toBe(true);
  });
});
