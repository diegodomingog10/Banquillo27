/**
 * Calibración del motor: simula N partidos entre equipos de nivel igual y muestra
 * las métricas frente a los objetivos.
 *
 * Uso: npm run calibrate -- [--matches 5000] [--level 120] [--draw 0.3] [--seed 1]
 */
import { createRng } from '../src/engine/rng';
import { simulateMatch, type MatchTeamInput } from '../src/engine/matchEngine';
import { FORMATION_IDS, tacticFromFormation } from '../src/engine/tactics';
import { generateSquad } from '../src/data/generator/generateSquad';

const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const N = arg('matches', 5000);
const level = arg('level', 120);
const drawAversion = arg('draw', NaN);
const seed = arg('seed', 1);
/** Ajustes de configuración en JSON para probar: --cfg '{"k":7}' */
const cfgArg = (() => { const i = process.argv.indexOf('--cfg'); return i >= 0 ? JSON.parse(process.argv[i + 1] ?? '{}') : {}; })();
const rng = createRng(seed);

const TEAMS = 40;
const teams: MatchTeamInput[] = Array.from({ length: TEAMS }, (_, i) => {
  const clubId = `t${i}`;
  return {
    clubId,
    name: `Equipo ${i}`,
    reputation: 5000,
    squad: generateSquad(rng.fork(clubId), { clubId, level }),
    tactic: tacticFromFormation(FORMATION_IDS[i % FORMATION_IDS.length] as string),
    familiarity: 80,
  };
});

const acc = { goals: 0, hg: 0, ag: 0, shots: 0, sot: 0, xg: 0, draws: 0, hw: 0, aw: 0, corners: 0, fouls: 0, yellow: 0, red: 0,
  offsides: 0, poss: 0, injuries: 0, subs: 0, ratingSum: 0, ratingN: 0, phases: 0, penalties: 0, passes: 0, passPct: 0, late: 0 };
const scoreDist = new Map<number, number>();
const t0 = performance.now();
for (let m = 0; m < N; m++) {
  const h = rng.int(0, TEAMS - 1);
  let a = rng.int(0, TEAMS - 2);
  if (a >= h) a++;
  const r = simulateMatch({
    seed: rng.int(1, 2 ** 31 - 1),
    home: teams[h]!,
    away: teams[a]!,
    detail: 'fast',
    config: { ...cfgArg, ...(Number.isFinite(drawAversion) ? { drawAversion } : {}) },
    context: { matchId: `m${m}`, competitionId: 'cal', season: '2026/27', round: '1', date: '2026-08-15', capacity: 30000 },
  });
  const res = r.match.result!;
  const s = r.match.stats!;
  acc.hg += res.homeGoals;
  acc.ag += res.awayGoals;
  acc.goals += res.homeGoals + res.awayGoals;
  scoreDist.set(res.homeGoals + res.awayGoals, (scoreDist.get(res.homeGoals + res.awayGoals) ?? 0) + 1);
  if (res.homeGoals === res.awayGoals) acc.draws++;
  else if (res.homeGoals > res.awayGoals) acc.hw++;
  else acc.aw++;
  acc.shots += s.home.shots + s.away.shots;
  acc.sot += s.home.shotsOnTarget + s.away.shotsOnTarget;
  acc.xg += s.home.xg + s.away.xg;
  acc.corners += s.home.corners + s.away.corners;
  acc.fouls += s.home.fouls + s.away.fouls;
  acc.yellow += s.home.yellow + s.away.yellow;
  acc.red += s.home.red + s.away.red;
  acc.offsides += s.home.offsides + s.away.offsides;
  acc.passes += s.home.passes + s.away.passes;
  acc.passPct += (s.home.passesCompleted + s.away.passesCompleted) / Math.max(1, s.home.passes + s.away.passes);
  acc.poss += s.home.possession;
  acc.injuries += r.injuries.length;
  acc.subs += r.match.events.filter((e) => e.type === 'substitution').length;
  acc.penalties += r.match.events.filter((e) => e.type === 'penalty').length;
  acc.late += r.match.events.filter((e) => e.type === 'goal' && e.minute >= 75).length;
  acc.phases += r.phases;
  for (const x of r.match.ratings) { acc.ratingSum += x.rating; acc.ratingN++; }
}
const ms = performance.now() - t0;

// Equipo más fuerte
let strongWins = 0;
let strongDraws = 0;
const strong: MatchTeamInput = { ...teams[0]!, clubId: 'fuerte', squad: generateSquad(rng.fork('fuerte'), { clubId: 'fuerte', level: level + 25 }) };
const SN = 500;
for (let m = 0; m < SN; m++) {
  const opp = teams[rng.int(1, TEAMS - 1)]!;
  const home = m % 2 === 0;
  const r = simulateMatch({ seed: rng.int(1, 2 ** 31 - 1), home: home ? strong : opp, away: home ? opp : strong, detail: 'fast', config: cfgArg,
    context: { matchId: `s${m}`, competitionId: 'cal', season: '2026/27', round: '1', date: '2026-08-15' } });
  const res = r.match.result!;
  const sg = home ? res.homeGoals : res.awayGoals;
  const og = home ? res.awayGoals : res.homeGoals;
  if (sg > og) strongWins++;
  else if (sg === og) strongDraws++;
}

const f = (v: number, d = 2) => v.toFixed(d);
const row = (name: string, value: string, target: string) => console.log(`  ${name.padEnd(30)} ${value.padStart(9)}   ${target}`);
console.log(`\nCalibración: ${N} partidos, nivel ${level}, ${f(ms / N, 2)} ms/partido\n`);
console.log('  Métrica                          Valor   Objetivo');
row('Goles por partido', f(acc.goals / N), '≈ 2,6');
row('Ventaja local (goles)', f((acc.hg - acc.ag) / N), '≈ 0,3');
row('Goles local / visitante', `${f(acc.hg / N)}/${f(acc.ag / N)}`, '');
row('Tiros por partido', f(acc.shots / N, 1), '≈ 25');
row('Tiros a puerta', f(acc.sot / N, 1), '≈ 8-9');
row('xG por partido', f(acc.xg / N), '≈ goles');
row('% empates', `${f((acc.draws / N) * 100, 1)} %`, 'ajustable con --draw (drawAversion)');
row('% victorias local / visitante', `${f((acc.hw / N) * 100, 0)}/${f((acc.aw / N) * 100, 0)}`, '');
row('Córners', f(acc.corners / N, 1), '≈ 10');
row('Faltas', f(acc.fouls / N, 1), '≈ 22');
row('Amarillas / rojas', `${f(acc.yellow / N, 1)}/${f(acc.red / N, 2)}`, '≈ 3,8 / 0,15');
row('Fueras de juego', f(acc.offsides / N, 1), '≈ 4');
row('Penaltis', f(acc.penalties / N, 2), '≈ 0,25');
row('Pases (precisión)', `${f(acc.passes / N, 0)} (${f((acc.passPct / N) * 100, 0)} %)`, '≈ 800 (80 %)');
row('Posesión local', `${f(acc.poss / N, 1)} %`, '≈ 50-52 %');
row('Lesiones por partido', f(acc.injuries / N, 2), '≈ 0,2-0,4');
row('Cambios por partido', f(acc.subs / N, 1), '≈ 7-9');
row('Goles desde el 75\'', `${f((acc.late / acc.goals) * 100, 0)} %`, '≈ 20-25 %');
row('Nota media', f(acc.ratingSum / acc.ratingN), '≈ 6,7');
row('Fases por partido', f(acc.phases / N, 0), '150-220');
row(`Equipo +25 CA gana / empata`, `${f((strongWins / SN) * 100, 0)}/${f((strongDraws / SN) * 100, 0)} %`, 'claramente favorito');
console.log('\n  Distribución de goles totales:', [...scoreDist.entries()].sort((a, b) => a[0] - b[0]).map(([g, c]) => `${g}:${f((c / N) * 100, 1)}%`).join('  '));
