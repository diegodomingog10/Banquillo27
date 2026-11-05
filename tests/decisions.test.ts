/**
 * Las decisiones del entrenador deben cambiar el partido de forma medible.
 * Todas las comparaciones usan las mismas semillas (pares).
 */
import { describe, expect, it } from 'vitest';
import { MatchSimulation, simulateMatch, type MatchResult, type MatchTeamInput } from '../src/engine/matchEngine';
import { autoLineup } from '../src/engine/lineup';
import { createRng } from '../src/engine/rng';
import { tacticFromFormation, type Mentality } from '../src/engine/tactics';
import { generateSquad } from '../src/data/generator/generateSquad';
import type { Player } from '../src/data/schema';

const rng = createRng(2024);
const ctx = { matchId: 'x', competitionId: 'c', season: 's', round: '1', date: '2026-08-15' };
const homeSquad = generateSquad(rng.fork('h'), { clubId: 'h', level: 120 });
const awaySquad = generateSquad(rng.fork('a'), { clubId: 'a', level: 120 });
const tactic = tacticFromFormation('4-4-2');
const lineup = autoLineup(homeSquad, tactic);
const away: MatchTeamInput = { clubId: 'a', name: 'a', reputation: 5000, squad: awaySquad, tactic: tacticFromFormation('4-4-2') };
const home = (over: Partial<MatchTeamInput> = {}): MatchTeamInput => ({ clubId: 'h', name: 'h', reputation: 5000, squad: homeSquad, tactic, lineup, ai: false, ...over });
const N = 160;

const shots = (r: MatchResult, id: string) => r.match.events.filter((e) => e.teamId === id && ['goal', 'save', 'shot', 'woodwork'].includes(e.type));
function aggregate(team: MatchTeamInput, seedBase: number) {
  let own = 0, riv = 0, rivXg = 0, gd = 0;
  for (let s = 1; s <= N; s++) {
    const r = simulateMatch({ seed: seedBase + s, home: team, away, context: ctx, detail: 'fast' });
    const rs = shots(r, 'a');
    own += shots(r, 'h').length;
    riv += rs.length;
    rivXg += rs.reduce((a, e) => a + (e.xg ?? 0), 0);
    gd += r.match.result!.homeGoals - r.match.result!.awayGoals;
  }
  return { own: own / N, riv: riv / N, rivXgPerShot: rivXg / riv, gd: gd / N };
}
const withMentality = (m: Mentality) => home({ tactic: { ...tactic, mentality: m } });

describe('decisiones del entrenador', () => {
  const balanced = aggregate(home(), 0);

  it('encerrarse: el rival tira más pero con peores ocasiones, y tú atacas menos', () => {
    const def = aggregate(withMentality(1), 0);
    expect(def.riv).toBeGreaterThan(balanced.riv);
    expect(def.rivXgPerShot).toBeLessThan(balanced.rivXgPerShot * 0.92);
    expect(def.own).toBeLessThan(balanced.own * 0.9);
  });

  it('salir a por el partido: más ocasiones propias y contras rivales más peligrosas', () => {
    const att = aggregate(withMentality(7), 0);
    expect(att.own).toBeGreaterThan(balanced.own * 1.08);
    expect(att.rivXgPerShot).toBeGreaterThan(balanced.rivXgPerShot);
  });

  it('jugar con 10 cuesta de forma clara (≈ medio gol por partido)', () => {
    const ten = aggregate(home({ lineup: { starting: lineup.starting.filter((_, i) => i !== 9), bench: lineup.bench } }), 0);
    expect(balanced.gd - ten.gd).toBeGreaterThan(0.3);
  });

  it('el ritmo de partido bajo empeora al equipo', () => {
    const rusty = aggregate(home({ squad: homeSquad.map((p) => ({ ...p, matchSharpness: 25 })) }), 0);
    const sharp = aggregate(home({ squad: homeSquad.map((p) => ({ ...p, matchSharpness: 95 })) }), 0);
    expect(sharp.gd).toBeGreaterThan(rusty.gd + 0.15);
  });

  it('un jugador caliente comete más faltas y ve más tarjetas, sobre todo en partidos tensos', () => {
    const slot = 6;
    const base = homeSquad.find((p) => p.id === lineup.starting[slot])!;
    const swap = (a: Partial<Player['attributes']>) => homeSquad.map((p) => (p.id === base.id ? { ...p, attributes: { ...p.attributes, ...a } } : p));
    const run = (squad: Player[], importance: number) => {
      let fouls = 0, cards = 0;
      for (let s = 1; s <= N; s++) {
        const r = simulateMatch({ seed: 5000 + s, home: home({ squad }), away, context: { ...ctx, importance }, detail: 'fast' });
        const st = r.playerStats[base.id]!;
        fouls += st.fouls; cards += st.yellow + st.red;
      }
      return { fouls, cards };
    };
    const calm = run(swap({ aggression: 6, temperament: 17 }), 0);
    const hot = run(swap({ aggression: 19, temperament: 3 }), 0);
    const hotTense = run(swap({ aggression: 19, temperament: 3 }), 1);
    expect(hot.fouls).toBeGreaterThan(calm.fouls * 1.3);
    expect(hot.cards).toBeGreaterThan(calm.cards * 1.3);
    expect(hotTense.fouls).toBeGreaterThan(hot.fouls);
  });

  it('piernas frescas: el suplente idéntico regatea mejor que el titular cansado', () => {
    const lmId = lineup.starting[5]!;
    const lm = homeSquad.find((p) => p.id === lmId)!;
    const fresh: Player = { ...lm, id: 'fresh', condition: 100 };
    const team = home({ squad: [...homeSquad, fresh], lineup: { starting: lineup.starting, bench: ['fresh', ...lineup.bench].slice(0, 9) } });
    let ok = [0, 0], att = [0, 0];
    for (let s = 1; s <= 300; s++) {
      for (const k of [0, 1]) {
        const sim = new MatchSimulation({ seed: 9000 + s, home: team, away, context: ctx, detail: 'fast' });
        sim.runToMinute(65);
        const before = { ...(sim.result().playerStats[lmId] ?? { dribbles: 0, dribblesAttempted: 0 }) };
        if (k === 1) sim.command(0, { type: 'substitution', outId: lmId, inId: 'fresh' });
        const r = sim.run();
        const st = r.playerStats[k === 1 ? 'fresh' : lmId];
        if (!st) continue;
        const d = k === 1 ? st.dribbles : st.dribbles - before.dribbles;
        const da = k === 1 ? st.dribblesAttempted : st.dribblesAttempted - before.dribblesAttempted;
        ok[k]! += d; att[k]! += da;
      }
    }
    expect(ok[1]! / att[1]!).toBeGreaterThan(ok[0]! / att[0]! + 0.025);
  });

  it('el rol decide la participación: el recuperador defiende más que el mediapunta', () => {
    const t = tacticFromFormation('4-2-3-1');
    const l = autoLineup(homeSquad, t);
    let dm = 0, am = 0;
    for (let s = 1; s <= 80; s++) {
      const r = simulateMatch({ seed: 7000 + s, home: home({ tactic: t, lineup: l }), away, context: ctx, detail: 'fast' });
      const d = r.playerStats[l.starting[6]!]!;
      const a = r.playerStats[l.starting[8]!]!;
      dm += d.tacklesAttempted + d.interceptions;
      am += a.tacklesAttempted + a.interceptions;
    }
    expect(dm).toBeGreaterThan(am * 1.3);
  });
});
