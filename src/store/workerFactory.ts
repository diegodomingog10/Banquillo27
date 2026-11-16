/**
 * Creación de los Workers. En la versión portátil (`npm run portable`, un único Banquillo.html que se abre con
 * doble clic) vite.config.ts sustituye este módulo por workerFactory.portable.ts, que los lleva incrustados.
 */
export const createGameWorker = (): Worker => new Worker(new URL('../workers/gameWorker.ts', import.meta.url), { type: 'module' });
export const createDataWorker = (): Worker => new Worker(new URL('../workers/dataWorker.ts', import.meta.url), { type: 'module' });
