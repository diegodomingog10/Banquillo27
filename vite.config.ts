import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Modo «portable» (`npm run portable`): todo en un único Banquillo.html que se abre con doble clic, sin servidor
 * ni instalación. Los Workers van incrustados y los recursos (CSS, fuentes) se incrustan en el propio HTML
 * (scripts/portable.mjs junta los archivos al terminar).
 */
export default defineConfig(({ mode }) => {
  const portable = mode === 'portable';
  return {
    plugins: [react(), tailwindcss()],
    // En la portátil, Workers clásicos: Chrome no arranca Workers de tipo módulo en una página abierta desde un archivo
    worker: { format: portable ? 'iife' : 'es' },
    base: portable ? './' : '/',
    resolve: portable
      ? { alias: [{ find: /^\.\/workerFactory$/, replacement: fileURLToPath(new URL('./src/store/workerFactory.portable.ts', import.meta.url)) }] }
      : undefined,
    build: portable
      ? { outDir: 'release/portable-build', emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false }
      : undefined,
    // Siempre el mismo puerto: las partidas guardadas van ligadas a la dirección (http://localhost:5173)
    server: { port: 5173, strictPort: true },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      testTimeout: 60000,
    },
  } as never;
});
