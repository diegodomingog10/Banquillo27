/**
 * Imprime en JSON los pesos de la habilidad actual (CA) por grupo posicional, para que
 * build_fc27.py pueda reequilibrar atributos con la misma fórmula que el juego.
 */
import { fullWeights } from '../../src/data/ability';
import { GROUP_OF_POSITION } from '../../src/data/positions';

const groups = [...new Set(Object.values(GROUP_OF_POSITION))];
console.log(JSON.stringify({ groupOf: GROUP_OF_POSITION, weights: Object.fromEntries(groups.map((g) => [g, fullWeights(g)])) }));
