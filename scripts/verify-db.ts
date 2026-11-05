/**
 * Verifica una base de datos (generada o importada).
 * Uso: npm run verify-db -- ruta/world.json [--min-squad 18]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDatabase } from '../src/data/verify';
import type { WorldDatabase } from '../src/data/schema';

const path = process.argv[2];
if (!path) {
  console.error('Uso: npm run verify-db -- ruta/world.json');
  process.exit(1);
}
const i = process.argv.indexOf('--min-squad');
const db = JSON.parse(readFileSync(resolve(path), 'utf8')) as WorldDatabase;
const r = verifyDatabase(db, { minSquad: i > 0 ? Number(process.argv[i + 1]) : undefined });
console.log(JSON.stringify(r.summary, null, 2));
console.log(`${r.errors.length} errores, ${r.warnings.length} avisos`);
for (const x of r.errors.slice(0, 50)) console.log(`  [error] ${x.entity} ${x.id ?? ''} ${x.field ?? ''}: ${x.message}`);
for (const x of r.warnings.slice(0, 50)) console.log(`  [aviso] ${x.entity} ${x.id ?? ''} ${x.field ?? ''}: ${x.message}`);
process.exit(r.ok ? 0 : 2);
