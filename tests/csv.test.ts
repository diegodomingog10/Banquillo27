import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/data/importers/csv';
import { parseDate, parseNumber } from '../src/data/importers/fields';

describe('parser CSV', () => {
  it('lee comillas, comillas escapadas y saltos de línea', () => {
    const r = parseCsv('id,name,note\n1,"Pérez, Juan","dijo ""hola""\nadiós"\n2,Ana,x\n');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ id: '1', name: 'Pérez, Juan', note: 'dijo "hola"\nadiós' });
    expect(r.lineNumbers).toEqual([2, 4]);
  });
  it('detecta punto y coma, tabuladores y BOM', () => {
    expect(parseCsv('﻿a;b\n1;2').rows[0]).toEqual({ a: '1', b: '2' });
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
  });
  it('informa de filas con columnas de más o de menos', () => {
    const r = parseCsv('a,b\n1,2,3\n4\n');
    expect(r.malformed).toHaveLength(2);
  });
  it('ida y vuelta con toCsv', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'z"q' }]);
    expect(parseCsv(csv).rows[0]).toEqual({ a: 'x,y', b: 'z"q' });
  });
});

describe('parsers de campos', () => {
  it('números en varios formatos', () => {
    expect(parseNumber('1.250.000')).toBe(1250000);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1,250,000')).toBe(1250000);
    expect(parseNumber('2.5M')).toBe(2500000);
    expect(parseNumber('800k')).toBe(800000);
    expect(parseNumber('€ 3 000')).toBe(3000);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('85%')).toBe(85);
    expect(parseNumber('')).toBeUndefined();
    expect(() => parseNumber('abc')).toThrow();
  });
  it('fechas', () => {
    expect(parseDate('2001-04-17')).toBe('2001-04-17');
    expect(parseDate('17/04/2001')).toBe('2001-04-17');
    expect(parseDate('2001-04-17T00:00:00Z')).toBe('2001-04-17');
    expect(() => parseDate('31/02/2001')).toThrow();
    expect(() => parseDate('ayer')).toThrow();
  });
});
