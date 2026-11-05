import { describe, expect, it } from 'vitest';
import { colorDistance, generateKits, KIT_COLORS, kitsClash, kitsOf, matchKits, type Kits } from '../src/data/kits';
import { generateWorld } from '../src/data/generator/generateWorld';
import { importDatabase } from '../src/data/importers/importDatabase';
import { createRng } from '../src/engine/rng';

const C = KIT_COLORS;
const club = (kits: Kits) => ({ colors: { primary: kits.home.shirt, secondary: kits.home.secondary }, kits });

describe('equipaciones', () => {
  it('cada club generado tiene local, visitante y portero distinguibles', () => {
    const rng = createRng(7);
    for (let i = 0; i < 300; i++) {
      const k = generateKits(rng);
      expect(colorDistance(k.goalkeeper.shirt, k.home.shirt)).toBeGreaterThan(140);
      expect(colorDistance(k.away.shirt, k.home.shirt)).toBeGreaterThan(120);
    }
  });
  it('el mundo generado guarda las equipaciones y los colores coinciden con la local', () => {
    const w = generateWorld({ seed: 3 });
    for (const c of w.clubs) {
      expect(c.kits).toBeDefined();
      expect(c.colors.primary).toBe(c.kits!.home.shirt);
    }
  });
  it('el visitante cambia de camiseta si choca con la del local', () => {
    const red = club({ home: { shirt: C.rojo!, secondary: C.blanco!, pattern: 'plain', shorts: C.blanco!, socks: C.rojo! }, away: { shirt: C.blanco!, secondary: C.rojo!, pattern: 'plain', shorts: C.blanco!, socks: C.blanco! }, goalkeeper: { shirt: C.verde!, secondary: C.negro!, pattern: 'plain', shorts: C.verde!, socks: C.verde! } });
    const red2 = club({ home: { shirt: '#C01020', secondary: C.negro!, pattern: 'stripes', shorts: C.negro!, socks: C.rojo! }, away: { shirt: C.amarillo!, secondary: C.rojo!, pattern: 'plain', shorts: C.amarillo!, socks: C.amarillo! }, goalkeeper: { shirt: C.verde!, secondary: C.negro!, pattern: 'plain', shorts: C.verde!, socks: C.verde! } });
    const mk = matchKits(red, red2);
    expect(mk.awayKit).toBe('away');
    expect(mk.away.shirt).toBe(C.amarillo);
    expect(kitsClash(mk.home, mk.away)).toBe(false);
    // Los porteros no se confunden con nadie
    for (const k of [mk.home, mk.away, mk.homeGk]) expect(kitsClash(k, mk.awayGk)).toBe(false);
  });
  it('sin choque, cada uno con su primera equipación', () => {
    const w = generateWorld({ seed: 5 });
    const [a, b] = w.clubs.filter((c) => colorDistance(c.kits!.home.shirt, w.clubs[0]!.kits!.home.shirt) > 300).slice(0, 1).concat(w.clubs[0]!);
    const mk = matchKits(b!, a!);
    expect(mk.awayKit).toBe('home');
  });
  it('deriva equipaciones de los colores si el club no las tiene', () => {
    const k = kitsOf({ colors: { primary: C.azul!, secondary: C.blanco! } });
    expect(k.home.shirt).toBe(C.azul);
    expect(k.away.shirt).toBe(C.blanco);
  });
  it('el importador lee las columnas de equipación (hex o nombres)', () => {
    const csv = 'id,name,nation,reputation,league_id,home_shirt,home_secondary,home_pattern,away_shirt\nc1,Club Uno,Tierra,5000,liga1,rojo,blanco,rayas,#14213D\nc2,Club Dos,Tierra,4000,liga1,azul,,,\n';
    const r = importDatabase([{ name: 'clubs.csv', content: csv }]);
    const c1 = r.database.clubs.find((c) => c.id === 'c1')!;
    expect(c1.kits!.home).toMatchObject({ shirt: C.rojo, secondary: C.blanco, pattern: 'stripes' });
    expect(c1.kits!.away.shirt).toBe('#14213D');
    const c2 = r.database.clubs.find((c) => c.id === 'c2')!;
    expect(c2.kits!.home.shirt).toBe(C.azul);
  });
});
