import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importDatabase, type ImportFile } from '../src/data/importers/importDatabase';
import { generateWorld } from '../src/data/generator/generateWorld';
import { WorldDatabase } from '../src/data/schema';
import { verifyDatabase } from '../src/data/verify';

const EX = join(__dirname, '..', 'data', 'examples');
const exampleCsv = (): ImportFile[] =>
  readdirSync(EX).filter((f) => f.endsWith('.csv')).map((f) => ({ name: f, content: readFileSync(join(EX, f), 'utf8') }));

const clubsCsv = 'id,name,nation,reputation,league_id\nc1,Club Uno,Tierra,5000,liga1\nc2,Club Dos,Tierra,4000,liga1\n';

describe('importador', () => {
  it('importa los CSV de ejemplo sin errores', () => {
    const r = importDatabase(exampleCsv());
    expect(r.errorCount).toBe(0);
    expect(r.counts.club.imported).toBe(3);
    expect(r.counts.player.imported).toBe(9);
    expect(r.playersFromStats).toBe(8);
    expect(WorldDatabase.safeParse(r.database).success).toBe(true);
    expect(verifyDatabase(r.database).errors).toEqual([]);
  });
  it('importa el JSON de ejemplo', () => {
    const r = importDatabase([{ name: 'example-database.json', content: readFileSync(join(EX, 'example-database.json'), 'utf8') }]);
    expect(r.errorCount).toBe(0);
    expect(r.counts.player.imported).toBe(9);
    const p3 = r.database.players.find((p) => p.id === 'lus_0003')!;
    expect(p3.ca).toBe(142); // CA declarada se respeta
    expect(p3.pa).toBe(168);
    expect(p3.attributes.finishing).toBe(16);
    expect(p3.estimated).toContain('attributes.tackling');
    expect(p3.estimated).not.toContain('attributes.finishing');
  });
  it('una fila mala no rompe el resto y se informa con archivo y fila', () => {
    const players = [
      'id,first_name,last_name,birth_date,club_id,positions,passing',
      'p1,Ana,Uno,2000-01-01,c1,CM,14',
      'p2,,,2000-01-01,c1,CM,14', // sin nombre
      'p3,Bea,Tres,ayer,c1,ST,12', // fecha mala: aviso + estimado
      'p4,Caro,Cuatro,2001-02-02,c1,XX,40', // posición desconocida, atributo escala 1-100
    ].join('\n');
    const r = importDatabase([{ name: 'clubs.csv', content: clubsCsv }, { name: 'players.csv', content: players }]);
    expect(r.counts.player.read).toBe(4);
    expect(r.counts.player.imported).toBe(3);
    const err = r.issues.find((i) => i.severity === 'error' && i.entity === 'player');
    expect(err).toMatchObject({ file: 'players.csv', row: 3, field: 'name' });
    const p3 = r.database.players.find((p) => p.id === 'p3')!;
    expect(p3.estimated).toContain('birthDate');
    expect(r.issues.some((i) => i.row === 4 && i.field === 'birthDate')).toBe(true);
    const p4 = r.database.players.find((p) => p.id === 'p4')!;
    expect(p4.attributes.passing).toBe(8); // 40/5
    expect(r.issues.some((i) => i.row === 5 && i.field === 'positions')).toBe(true);
  });
  it('detecta ids duplicados y posibles duplicados', () => {
    const players = [
      'id,name,birth_date,club,position',
      'p1,Ana Uno,2000-01-01,Club Uno,CM',
      'p1,Ana Otra,2000-01-01,Club Uno,CM',
      'p9,Ana Uno,2000-01-01,Club Dos,CM',
    ].join('\n');
    const r = importDatabase([{ name: 'clubs.csv', content: clubsCsv }, { name: 'players.csv', content: players }]);
    expect(r.counts.player.imported).toBe(2);
    expect(r.issues.some((i) => i.severity === 'error' && /duplicado/.test(i.message) && i.row === 3)).toBe(true);
    expect(r.issues.some((i) => i.severity === 'warning' && /posible duplicado/.test(i.message) && i.id === 'p9')).toBe(true);
    // el club se resolvió por nombre
    expect(r.database.players.find((p) => p.id === 'p9')!.clubId).toBe('c2');
  });
  it('crea naciones y ligas que solo aparecen como referencia', () => {
    const r = importDatabase([{ name: 'clubs.csv', content: clubsCsv }]);
    expect(r.database.nations.map((n) => n.name)).toEqual(['Tierra']);
    const liga = r.database.competitions.find((c) => c.name === 'liga1')!;
    expect(liga.teamIds.sort()).toEqual(['c1', 'c2']);
    expect(liga.estimated).toContain('level');
  });
  it('club inexistente => agente libre con aviso', () => {
    const r = importDatabase([{ name: 'players.csv', content: 'id,name,club,position\nx1,Sin Club,Fantasma FC,ST\n' }]);
    const p = r.database.players[0]!;
    expect(p.clubId).toBeNull();
    expect(p.contract).toBeNull();
    expect(r.issues.some((i) => i.field === 'club' && i.severity === 'warning')).toBe(true);
  });
  it('marca como estimados los datos que faltan', () => {
    const r = importDatabase([{ name: 'clubs.csv', content: clubsCsv }, { name: 'players.csv', content: 'id,name,club_id\nx,Solo Nombre,c1\n' }]);
    const p = r.database.players[0]!;
    for (const f of ['birthDate', 'positions', 'heightCm', 'ca', 'pa', 'contract.wage', 'marketValue', 'attributes.passing']) {
      expect(p.estimated).toContain(f);
    }
  });
  it('fusiona con un mundo generado y completa plantillas', () => {
    const base = generateWorld({ seed: 3, nations: 1 });
    const someClub = base.clubs[0]!;
    const r = importDatabase(
      [{ name: 'players.csv', content: `id,name,club_id,position,ca\nnew1,Nuevo Fichaje,${someClub.id},ST,150\n` }],
      { base },
    );
    expect(r.database.meta.source).toBe('mixed');
    expect(r.database.players.length).toBe(base.players.length + 1);
    const filled = importDatabase(exampleCsv(), { fillSquads: true, minSquad: 22 });
    const squad = filled.database.players.filter((p) => p.clubId === 'cl_puerto');
    expect(squad.length).toBe(22);
    expect(filled.database.staff.length).toBeGreaterThan(0);
    expect(verifyDatabase(filled.database).warnings.filter((w) => w.field === 'squad')).toEqual([]);
  });
  it('informa de JSON y archivos no reconocidos', () => {
    const r = importDatabase([{ name: 'cosas.json', content: '{ roto' }, { name: 'misc.csv', content: 'a,b\n1,2' }]);
    expect(r.issues.filter((i) => i.entity === 'file')).toHaveLength(2);
  });
  it('es determinista', () => {
    const a = importDatabase(exampleCsv());
    const b = importDatabase(exampleCsv());
    expect(JSON.stringify(a.database)).toBe(JSON.stringify(b.database));
  });
});
