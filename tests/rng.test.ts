import { describe, expect, it } from 'vitest';
import { createRng, hashString } from '../src/engine/rng';

describe('rng (mulberry32)', () => {
  it('es determinista con la misma semilla', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('acepta semillas de texto', () => {
    expect(createRng('banquillo').next()).toBe(createRng('banquillo').next());
    expect(hashString('a')).not.toBe(hashString('b'));
  });
  it('produce valores en rango', () => {
    const r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = r.int(-3, 5);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('tiene media y dispersión razonables', () => {
    const r = createRng(99);
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.normal(10, 2);
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(10, 1);
    expect(Math.sqrt(sq / n - mean * mean)).toBeCloseTo(2, 1);
  });
  it('fork crea flujos deterministas e independientes', () => {
    const a = createRng(1).fork('x');
    const b = createRng(1).fork('x');
    const c = createRng(1).fork('y');
    const va = a.next();
    expect(va).toBe(b.next());
    expect(va).not.toBe(c.next());
  });
  it('weighted respeta los pesos', () => {
    const r = createRng(5);
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (r.weighted(['a', 'b'], [9, 1]) === 'a') hits++;
    expect(hits / 10000).toBeGreaterThan(0.87);
    expect(hits / 10000).toBeLessThan(0.93);
  });
});
