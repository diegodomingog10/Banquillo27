/**
 * Junta la compilación portátil (vite build --mode portable) en un único Banquillo.html y prepara
 * release/Banquillo-portable.zip con el juego, unas instrucciones y, si existe, la base de datos real.
 * Uso: npm run portable
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const build = 'release/portable-build';
const outDir = 'release/Banquillo';
let html = readFileSync(join(build, 'index.html'), 'utf8');

// <script type="module" src="./assets/x.js"> → script en línea; <link rel="stylesheet" href="./assets/x.css"> → <style>
html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) => {
  const js = readFileSync(join(build, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${readFileSync(join(build, href), 'utf8')}</style>`);
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('Quedan recursos sin incrustar en el HTML');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'Banquillo.html'), html);
const world = 'data/real/world-fc27.json';
const hasWorld = existsSync(world);
if (hasWorld) copyFileSync(world, join(outDir, 'world-fc27.json'));
writeFileSync(join(outDir, 'LEEME.txt'), [
  'BANQUILLO - versión portátil',
  '',
  '1. Descomprime esta carpeta donde quieras (por ejemplo, en el Escritorio).',
  '2. Abre «Banquillo.html» con doble clic. Se abre en el navegador (mejor Chrome o Edge).',
  '   No hace falta instalar nada ni conexión a internet.',
  hasWorld ? '3. La primera vez: Importar base de datos -> Elegir archivos -> «world-fc27.json» (está en esta carpeta)\n   -> Importar -> Usar esta base de datos -> Nueva partida -> Base cargada.' : '3. Nueva partida para jugar en un mundo ficticio, o Importar base de datos con tus datos.',
  '',
  'Las partidas se guardan en el navegador de este ordenador. No muevas ni renombres Banquillo.html',
  'después de empezar: el navegador las asocia a su ubicación (con «Exportar» en el menú del juego',
  'puedes sacar una copia de una partida).',
  '',
].join('\r\n'));
rmSync('release/Banquillo-portable.zip', { force: true });
execFileSync('zip', ['-r', '-q', '-9', 'Banquillo-portable.zip', 'Banquillo'], { cwd: 'release' });
const kb = (f) => Math.round(readFileSync(f).length / 1024);
console.log(`Banquillo.html: ${kb(join(outDir, 'Banquillo.html'))} KB · release/Banquillo-portable.zip: ${kb('release/Banquillo-portable.zip')} KB${hasWorld ? ' (con la base de datos real)' : ''}`);
console.log('Archivos:', readdirSync(outDir).join(', '));
