/**
 * Genera un mundo ficticio y lo guarda en data/generated/world-<semilla>.json.
 * Uso: npm run generate -- [--seed 42] [--nations 8] [--out ruta.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateWorld } from '../src/data/generator/generateWorld';
import { WorldDatabase } from '../src/data/schema';
import { verifyDatabase } from '../src/data/verify';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = Number(arg('seed') ?? 42);
const nations = Number(arg('nations') ?? 8);
const out = resolve(arg('out') ?? `data/generated/world-${seed}.json`);

const t0 = performance.now();
const world = generateWorld({ seed, nations });
const t1 = performance.now();
const parsed = WorldDatabase.safeParse(world);
if (!parsed.success) {
  console.error('El mundo generado no cumple el esquema:', parsed.error.issues.slice(0, 10));
  process.exit(1);
}
const report = verifyDatabase(world);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(world));
console.log(`Mundo generado en ${(t1 - t0).toFixed(0)} ms (semilla ${seed})`);
console.log(`  ${world.nations.length} naciones, ${world.competitions.length} competiciones, ${world.clubs.length} clubes`);
console.log(`  ${world.players.length} jugadores, ${world.staff.length} miembros de staff`);
console.log(`  Verificación: ${report.errors.length} errores, ${report.warnings.length} avisos`);
console.log(`  Guardado en ${out}`);
