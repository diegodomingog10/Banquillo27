/**
 * Importa una base de datos real desde CSV/JSON.
 *
 * Uso:
 *   npm run import -- ruta/a/carpeta_o_archivo [más rutas] [opciones]
 *
 * Opciones:
 *   --out <archivo>       Destino (por defecto data/imported/world.json)
 *   --fill                Completar plantillas incompletas con jugadores ficticios y crear staff
 *   --min-squad <n>       Tamaño mínimo de plantilla para --fill (22)
 *   --merge <world.json>  Fusionar con una base existente (p. ej. un mundo generado)
 *   --mapping <json>      Tabla de conversión estadísticas→atributos alternativa
 *   --start <AAAA-MM-DD>  Fecha de inicio de partida
 *   --name <texto>        Nombre de la base de datos
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { importDatabase, type ImportFile } from '../src/data/importers/importDatabase';
import { toCsv } from '../src/data/importers/csv';
import { WorldDatabase } from '../src/data/schema';
import { loadStatsMapping } from '../src/data/statsToAttributes';
import { verifyDatabase } from '../src/data/verify';

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const paths: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--') && !['--fill'].includes(a)) {
      flags.set(a.slice(2), next);
      i++;
    } else flags.set(a.slice(2), true);
  } else paths.push(a);
}
if (paths.length === 0) {
  console.error('Uso: npm run import -- ruta/datos [--fill] [--merge world.json] [--out salida.json]');
  process.exit(1);
}

const files: ImportFile[] = [];
const collect = (p: string) => {
  const abs = resolve(p);
  if (!existsSync(abs)) {
    console.error(`No existe: ${abs}`);
    process.exit(1);
  }
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs).sort()) if (/\.(csv|json|tsv|txt)$/i.test(f)) collect(join(abs, f));
  } else files.push({ name: basename(abs), content: readFileSync(abs, 'utf8') });
};
paths.forEach(collect);
console.log(`Leyendo ${files.length} archivo(s): ${files.map((f) => f.name).join(', ')}`);

const str = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);
const mergePath = str('merge');
const base = mergePath ? WorldDatabase.parse(JSON.parse(readFileSync(resolve(mergePath), 'utf8'))) : undefined;
const mappingPath = str('mapping');
const mapping = mappingPath ? loadStatsMapping(JSON.parse(readFileSync(resolve(mappingPath), 'utf8'))) : undefined;

const t0 = performance.now();
const result = importDatabase(files, {
  base,
  mapping,
  fillSquads: flags.has('fill'),
  minSquad: str('min-squad') ? Number(str('min-squad')) : undefined,
  startDate: str('start'),
  name: str('name'),
});
result.database.meta.createdAt = new Date().toISOString();
const ms = performance.now() - t0;

const out = resolve(str('out') ?? 'data/imported/world.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result.database, null, 1));
const reportPath = out.replace(/\.json$/, '') + '.import-report.csv';
writeFileSync(reportPath, toCsv(['severity', 'file', 'row', 'entity', 'id', 'field', 'message'], result.issues as never));

const verify = verifyDatabase(result.database);
const c = result.counts;
console.log(`\nImportación completada en ${ms.toFixed(0)} ms`);
console.log('  Entidad        leídos  importados  descartados');
for (const k of ['nation', 'club', 'competition', 'player', 'staff'] as const) {
  console.log(`  ${k.padEnd(13)} ${String(c[k].read).padStart(7)} ${String(c[k].imported).padStart(11)} ${String(c[k].skipped).padStart(12)}`);
}
console.log(`  Jugadores con atributos desde estadísticas: ${result.playersFromStats}`);
console.log(`  Jugadores con algún dato estimado: ${result.playersEstimated}`);
if (result.generatedFill) console.log(`  Jugadores ficticios añadidos (--fill): ${result.generatedFill}`);
console.log(`  Incidencias: ${result.errorCount} errores, ${result.warningCount} avisos, ${result.issues.length - result.errorCount - result.warningCount} informativas`);
for (const i of result.issues.filter((x) => x.severity !== 'info').slice(0, 25)) {
  console.log(`   [${i.severity}] ${i.file}${i.row ? `:${i.row}` : ''} ${i.entity}${i.id ? ` ${i.id}` : ''}${i.field ? ` (${i.field})` : ''}: ${i.message}`);
}
console.log(`\nVerificación: ${verify.errors.length} errores, ${verify.warnings.length} avisos`);
for (const i of [...verify.errors, ...verify.warnings].slice(0, 15)) console.log(`   ${i.entity} ${i.id ?? ''} ${i.field ?? ''}: ${i.message}`);
console.log(`\nBase de datos: ${out}\nInforme:       ${reportPath}`);
process.exit(result.errorCount > 0 || !verify.ok ? 2 : 0);
