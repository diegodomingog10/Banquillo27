/** Versión portátil: los Workers van incrustados en el propio HTML (funciona abriendo el archivo sin servidor). */
import GameWorker from '../workers/gameWorker.ts?worker&inline';
import DataWorker from '../workers/dataWorker.ts?worker&inline';

export const createGameWorker = (): Worker => new GameWorker();
export const createDataWorker = (): Worker => new DataWorker();
