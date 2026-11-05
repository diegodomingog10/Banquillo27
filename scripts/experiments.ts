/**
 * Experimentos de decisiones: mide cuánto cambian el resultado las decisiones del
 * entrenador (mentalidad, cambios, carácter del suplente, jugar con 10, ritmo de
 * partido, rol). Cada comparación usa las MISMAS semillas: todo es idéntico hasta el
 * momento de la decisión.
 *
 * Uso: npm run experiments -- [--n 1500]
 */
import { createRng } from '../src/engine/rng';
import { MatchSimulation, simulateMatch, type MatchResult, type MatchTeamInput } from '../src/engine/matchEngine';
import { tacticFromFormation, type Mentality } from '../src/engine/tactics';
import { autoLineup } from '../src/engine/lineup';
import { generateSquad } from '../src/data/generator/generateSquad';
import type { Player } from '../src/data/schema';

const argN = (() => { const i = process.argv.indexOf('--n'); return i >= 0 ? Number(process.argv[i + 1]) : 1500; })();
const rng = createRng(11);
const ctx = { matchId: 'x', competitionId: 'c', season: 's', round: '1', date: '2026-08-15' };
const pct = (x: number, n: number) => `${((x / n) * 100).toFixed(1)}%`.padStart(7);
const num = (x: number, n: number, d = 2) => (x / n).toFixed(d).padStart(6);

const tactic = tacticFromFormation('4-4-2');
const homeSquad = generateSquad(rng.fork('h'), { clubId: 'h', level: 120 });
const awaySquad = generateSquad(rng.fork('a'), { clubId: 'a', level: 120 });
const lineup = autoLineup(homeSquad, tactic);
const away: MatchTeamInput = { clubId: 'a', name: 'Rival', reputation: 5000, squad: awaySquad, tactic: tacticFromFormation('4-4-2') };

// Suplentes: el mismo mediocentro (slot 6) con distinto carácter, y un extremo idéntico al titular
const cmId = lineup.starting[6]!;
const cm = homeSquad.find((p) => p.id === cmId)!;
const lmId = lineup.starting[5]!;
const lm = homeSquad.find((p) => p.id === lmId)!;
const clone = (base: Player, id: string, a: Partial<Player['attributes']> = {}, extra: Partial<Player> = {}): Player =>
  ({ ...base, id, attributes: { ...base.attributes, ...a }, condition: 100, ...extra });
const subs = {
  calm: clone(cm, 'sub_calm', { aggression: 6, temperament: 17 }),
  hot: clone(cm, 'sub_hot', { aggression: 19, temperament: 3 }),
  freshWinger: clone(lm, 'sub_wing'),
};
const squad = [...homeSquad, ...Object.values(subs)];
const bench = [...Object.values(subs).map((s) => s.id), ...lineup.bench].slice(0, 12);
const home: MatchTeamInput = { clubId: 'h', name: 'Local', reputation: 5000, squad, tactic, lineup: { starting: lineup.starting, bench }, ai: false };

function after(r: MatchResult, minute: number, teamId: string) {
  const ev = r.match.events.filter((e) => e.minute >= minute && e.teamId === teamId);
  const shots = ev.filter((e) => e.type === 'goal' || e.type === 'save' || e.type === 'shot' || e.type === 'woodwork');
  const xg = shots.reduce((a, e) => a + (e.xg ?? 0), 0);
  return { shots: shots.length, xg, goals: ev.filter((e) => e.type === 'goal').length };
}

// ------------------------------------------------------------ E1 y E2: 1-0 en el 70'
interface Acc { n: number; win: number; draw: number; loss: number; rivScores: number; rivShots: number; rivXg: number; ownShots: number; ownGoals: number; fouls: number; yellow: number; red: number }
const newAcc = (): Acc => ({ n: 0, win: 0, draw: 0, loss: 0, rivScores: 0, rivShots: 0, rivXg: 0, ownShots: 0, ownGoals: 0, fouls: 0, yellow: 0, red: 0 });
type V = { sub?: string; out?: string; mentality?: Mentality };
const variants: Record<string, V> = {
  'Sin cambios (equilibrada)': {},
  'Mentalidad muy defensiva': { mentality: 1 },
  'Mentalidad defensiva': { mentality: 2 },
  'Mentalidad ofensiva': { mentality: 6 },
  'Mentalidad muy ofensiva': { mentality: 7 },
  'Entra MC tranquilo': { sub: subs.calm.id, out: cmId },
  'Entra MC caliente': { sub: subs.hot.id, out: cmId },
};
const acc: Record<string, Acc> = {};
let seed = 0;
let found = 0;
while (found < argN) {
  seed++;
  const probe = new MatchSimulation({ seed, home, away, context: ctx, detail: 'fast' });
  probe.runToMinute(70);
  const [h, a] = probe.score;
  if (h !== 1 || a !== 0) continue;
  found++;
  for (const [name, v] of Object.entries(variants)) {
    const sim = new MatchSimulation({ seed, home, away, context: ctx, detail: 'fast' });
    sim.runToMinute(70);
    if (v.sub && v.out) sim.command(0, { type: 'substitution', outId: v.out, inId: v.sub });
    if (v.mentality) sim.command(0, { type: 'mentality', mentality: v.mentality });
    const r = sim.run();
    const res = r.match.result!;
    const o = (acc[name] ??= newAcc());
    o.n++;
    if (res.homeGoals > res.awayGoals) o.win++; else if (res.homeGoals === res.awayGoals) o.draw++; else o.loss++;
    const riv = after(r, 70, 'a');
    const own = after(r, 70, 'h');
    if (riv.goals > 0) o.rivScores++;
    o.rivShots += riv.shots; o.rivXg += riv.xg; o.ownShots += own.shots; o.ownGoals += own.goals;
    if (v.sub) { const s = r.playerStats[v.sub]; if (s) { o.fouls += s.fouls; o.yellow += s.yellow; o.red += s.red; } }
  }
}
console.log(`\nE1/E2 · El local gana 1-0 en el 70' (${found} partidos, mismas semillas en cada fila)\n`);
console.log('Decisión en el 70\'              gana  empata  pierde | rival: marca  tiros  xG/tiro | propios: tiros  goles | suplente: faltas  amarilla   roja');
for (const [k, o] of Object.entries(acc)) {
  const sub = k.startsWith('Entra') ? `   ${num(o.fouls, o.n)}  ${pct(o.yellow, o.n)} ${pct(o.red, o.n)}` : '';
  console.log(`${k.padEnd(30)}${pct(o.win, o.n)}${pct(o.draw, o.n)}${pct(o.loss, o.n)} | ${pct(o.rivScores, o.n)} ${num(o.rivShots, o.n, 1)}  ${(o.rivXg / Math.max(1, o.rivShots)).toFixed(3).padStart(6)} |  ${num(o.ownShots, o.n, 1)} ${num(o.ownGoals, o.n)} |${sub}`);
}

// ------------------------------------------------------------ E2b: el mismo jugador caliente, sin tensión (entra al 20' con 0-0)
{
  let n = 0, fouls = 0, yellow = 0, red = 0, mins = 0;
  for (let s = 1; s <= argN; s++) {
    const sim = new MatchSimulation({ seed: 100000 + s, home, away, context: ctx, detail: 'fast' });
    sim.runToMinute(20);
    sim.command(0, { type: 'substitution', outId: cmId, inId: subs.hot.id });
    const r = sim.run();
    const st = r.playerStats[subs.hot.id];
    if (!st) continue;
    n++; fouls += st.fouls; yellow += st.yellow; red += st.red; mins += st.minutes;
  }
  console.log(`\nE2b · MC caliente que entra al 20' (contexto sin tensión): ${(fouls / mins * 90).toFixed(2)} faltas/90, roja ${pct(red, n)} en ~70', ${(red / mins * 90 * 100).toFixed(2)} % de roja por 90'`);
}

// ------------------------------------------------------------ E3: jugar con 10 desde el inicio
{
  const ten: MatchTeamInput = { ...home, lineup: { starting: lineup.starting.filter((_, i) => i !== 9), bench: lineup.bench } };
  let gf11 = 0, ga11 = 0, gf10 = 0, ga10 = 0;
  const N = argN;
  for (let s = 1; s <= N; s++) {
    const homeSide = s % 2 === 0;
    const c = { ...ctx };
    const r11 = simulateMatch({ seed: s, home: homeSide ? home : away, away: homeSide ? away : home, context: c, detail: 'fast' });
    const r10 = simulateMatch({ seed: s, home: homeSide ? ten : away, away: homeSide ? away : ten, context: c, detail: 'fast' });
    const g = (r: MatchResult) => homeSide ? [r.match.result!.homeGoals, r.match.result!.awayGoals] : [r.match.result!.awayGoals, r.match.result!.homeGoals];
    const [a1, b1] = g(r11); const [a2, b2] = g(r10);
    gf11 += a1!; ga11 += b1!; gf10 += a2!; ga10 += b2!;
  }
  console.log(`\nE3 · 90' con 10 jugadores (${N} partidos, local/visitante alternos)`);
  console.log(`  Con 11: marca ${(gf11 / N).toFixed(2)}, encaja ${(ga11 / N).toFixed(2)}  ·  Con 10: marca ${(gf10 / N).toFixed(2)} (${((gf10 / gf11 - 1) * 100).toFixed(0)} %), encaja ${(ga10 / N).toFixed(2)} (+${((ga10 / ga11 - 1) * 100).toFixed(0)} %)  ·  diferencia de goles ${(((gf10 - ga10) - (gf11 - ga11)) / N).toFixed(2)}`);
}

// ------------------------------------------------------------ E4: piernas frescas en la banda (65')
{
  let n = 0;
  const acc4 = { keep: { xg: 0, drb: 0, drbA: 0, goals: 0 }, change: { xg: 0, drb: 0, drbA: 0, goals: 0 } };
  for (let s = 1; s <= argN; s++) {
    for (const mode of ['keep', 'change'] as const) {
      const sim = new MatchSimulation({ seed: 200000 + s, home, away, context: ctx, detail: 'fast' });
      sim.runToMinute(65);
      if (mode === 'change') sim.command(0, { type: 'substitution', outId: lmId, inId: subs.freshWinger.id });
      const r = sim.run();
      const own = after(r, 65, 'h');
      const st = r.playerStats[mode === 'change' ? subs.freshWinger.id : lmId];
      if (!st) continue;
      const o = acc4[mode];
      o.xg += own.xg; o.goals += own.goals; o.drb += st.dribbles; o.drbA += st.dribblesAttempted;
    }
    n++;
  }
  const k = acc4.keep; const c = acc4.change;
  console.log(`\nE4 · Cambiar en el 65' al interior izquierdo cansado por uno idéntico y fresco (${n} partidos)`);
  console.log(`  Sin cambio: xG del equipo desde el 65' ${num(k.xg, n)}, goles ${num(k.goals, n)}, regates del interior ${pct(k.drb, k.drbA)} de éxito`);
  console.log(`  Con cambio: xG del equipo desde el 65' ${num(c.xg, n)}, goles ${num(c.goals, n)}, regates del interior ${pct(c.drb, c.drbA)} de éxito`);
}

// ------------------------------------------------------------ E5: ritmo de partido
{
  const withSharp = (v: number): MatchTeamInput => ({ ...home, squad: squad.map((p) => ({ ...p, matchSharpness: v })) });
  const lo = withSharp(30), hi = withSharp(95);
  let dLo = 0, dHi = 0;
  const N = argN;
  for (let s = 1; s <= N; s++) {
    const a1 = simulateMatch({ seed: s, home: hi, away, context: ctx, detail: 'fast' }).match.result!;
    const a2 = simulateMatch({ seed: s, home: lo, away, context: ctx, detail: 'fast' }).match.result!;
    dHi += a1.homeGoals - a1.awayGoals; dLo += a2.homeGoals - a2.awayGoals;
  }
  console.log(`\nE5 · Ritmo de partido 95 frente a 30 (mismo equipo): diferencia de goles ${(dHi / N).toFixed(2)} frente a ${(dLo / N).toFixed(2)}`);
}

// ------------------------------------------------------------ E6: participación por rol
{
  const t4231 = tacticFromFormation('4-2-3-1');
  const l = autoLineup(homeSquad, t4231);
  const team: MatchTeamInput = { ...home, squad: homeSquad, tactic: t4231, lineup: l };
  const ids = { dmDef: l.starting[6]!, dmSup: l.starting[5]!, am: l.starting[8]! };
  const tot: Record<string, { def: number; min: number }> = { dmDef: { def: 0, min: 0 }, dmSup: { def: 0, min: 0 }, am: { def: 0, min: 0 } };
  for (let s = 1; s <= 400; s++) {
    const r = simulateMatch({ seed: 300000 + s, home: team, away, context: ctx, detail: 'fast' });
    for (const [k, id] of Object.entries(ids)) {
      const st = r.playerStats[id]; if (!st) continue;
      tot[k]!.def += st.tacklesAttempted + st.interceptions; tot[k]!.min += st.minutes;
    }
  }
  const per90 = (k: string) => ((tot[k]!.def / tot[k]!.min) * 90).toFixed(1);
  console.log(`\nE6 · Acciones defensivas por 90' en un 4-2-3-1: recuperador (defensa) ${per90('dmDef')}, organizador retrasado (apoyo) ${per90('dmSup')}, mediapunta (ataque) ${per90('am')}\n`);
}
