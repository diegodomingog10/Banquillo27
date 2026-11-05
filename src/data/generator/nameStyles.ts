/**
 * Estilos de nombres inventados por "cultura" ficticia. Se combinan sílabas para
 * producir nombres verosímiles que no pertenecen a jugadores ni clubes reales.
 */
import type { Rng } from '../../engine/rng';

export interface NameStyle {
  id: string;
  firstStarts: readonly string[];
  firstEnds: readonly string[];
  lastStarts: readonly string[];
  lastEnds: readonly string[];
  cityEnds: readonly string[];
  /** Plantillas de nombre de club; {c} = ciudad. */
  clubPatterns: readonly string[];
  stadiumPatterns: readonly string[];
}

export const NAME_STYLES: Record<string, NameStyle> = {
  iberico: {
    id: 'iberico',
    firstStarts: ['Al', 'Ber', 'Cas', 'Dar', 'El', 'Fer', 'Gal', 'Hel', 'Is', 'Jul', 'Lor', 'Mar', 'Nic', 'Os', 'Ram', 'Ser', 'Teo', 'Val', 'Ad', 'Rub'],
    firstEnds: ['io', 'án', 'el', 'ino', 'ón', 'ero', 'aro', 'ando', 'ito', 'ián'],
    lastStarts: ['Ar', 'Bel', 'Cor', 'Dom', 'Esc', 'Gar', 'Lar', 'Mon', 'Nav', 'Ol', 'Par', 'Quin', 'Rob', 'Sal', 'Tor', 'Ur', 'Ver', 'Zam'],
    lastEnds: ['ez', 'ado', 'illa', 'ero', 'ales', 'ueta', 'anco', 'ido', 'ena', 'ares'],
    cityEnds: ['ona', 'ada', 'ejo', 'era', 'illa', 'al', 'osa', 'ín'],
    clubPatterns: ['Deportivo {c}', 'Atlético {c}', 'CD {c}', 'Unión {c}', '{c} CF', 'Racing {c}', 'Real {c}', 'Sporting {c}', 'UD {c}'],
    stadiumPatterns: ['Estadio {s}', 'Campo de {c}', 'Estadio Municipal de {c}', 'Nuevo {s}'],
  },
  nordico: {
    id: 'nordico',
    firstStarts: ['Bj', 'Ei', 'Fr', 'Ha', 'Ja', 'Kn', 'Le', 'Ma', 'Ny', 'Ol', 'Ra', 'Si', 'Tor', 'Ul', 'Vi', 'As', 'Ste'],
    firstEnds: ['orn', 'nar', 'ik', 'ar', 'le', 've', 'ger', 'mund', 'nus', 'in'],
    lastStarts: ['Ahl', 'Berg', 'Dahl', 'Ek', 'Fjell', 'Gran', 'Holm', 'Lind', 'Mal', 'Nord', 'Ros', 'Sand', 'Strøm', 'Vik', 'Wes', 'Hag'],
    lastEnds: ['sen', 'lund', 'gren', 'strand', 'by', 'vik', 'heim', 'qvist', 'stad', 'dal'],
    cityEnds: ['vik', 'fjord', 'by', 'holm', 'stad', 'havn', 'berg', 'sund'],
    clubPatterns: ['{c} IF', '{c} BK', 'FK {c}', '{c} SK', 'IK {c}', '{c} FF'],
    stadiumPatterns: ['{c} Arena', '{s} Stadion', '{c} Idrettspark', '{c}vallen'],
  },
  eslavo: {
    id: 'eslavo',
    firstStarts: ['Bo', 'Dra', 'Go', 'Iv', 'Mi', 'Ne', 'Pe', 'Ra', 'Sta', 'Vla', 'Zo', 'Ya', 'Lu', 'Da', 'Ti', 'Bra'],
    firstEnds: ['ran', 'jan', 'slav', 'mir', 'an', 'ko', 'rek', 'lek', 'dan', 'van'],
    lastStarts: ['Bra', 'Dob', 'Kov', 'Mar', 'Nov', 'Pav', 'Rad', 'Sto', 'Vuk', 'Zel', 'Kral', 'Hor', 'Lis', 'Jur', 'Pet', 'Sem'],
    lastEnds: ['ić', 'ov', 'enko', 'ski', 'ak', 'ek', 'evič', 'ar', 'ovski', 'in'],
    cityEnds: ['grad', 'ovo', 'ica', 'ava', 'insk', 'ec', 'opol', 'ina'],
    clubPatterns: ['FK {c}', 'NK {c}', 'Dinamo {c}', 'Lokomotiva {c}', '{c} Sport', 'Slavija {c}', 'Rudar {c}', 'Radnik {c}'],
    stadiumPatterns: ['Gradski stadion {c}', 'Stadion {s}', '{c} Arena', 'Stadion pod {s}'],
  },
  italico: {
    id: 'italico',
    firstStarts: ['Ales', 'Bru', 'Car', 'Da', 'Fa', 'Gia', 'Lu', 'Mat', 'Ni', 'Pao', 'Ric', 'Sa', 'Ste', 'Vit', 'Ema', 'Fil'],
    firstEnds: ['rio', 'no', 'lo', 'ndro', 'co', 'nzo', 'tteo', 'ele', 'ppe', 'vio'],
    lastStarts: ['Bel', 'Cap', 'Fer', 'Gal', 'Lom', 'Mar', 'Pel', 'Ros', 'Sar', 'Tor', 'Ven', 'Cas', 'Dal', 'Fio', 'Gen', 'Orl'],
    lastEnds: ['ini', 'etti', 'one', 'elli', 'ari', 'ucci', 'ato', 'iero', 'ese', 'ano'],
    cityEnds: ['ona', 'ano', 'ia', 'ento', 'ola', 'ezia', 'ara', 'ino'],
    clubPatterns: ['{c} Calcio', 'AC {c}', 'US {c}', 'Sporting {c}', 'Virtus {c}', 'FC {c}', 'SS {c}', 'Pro {c}'],
    stadiumPatterns: ['Stadio {s}', 'Stadio Comunale di {c}', 'Arena {s}', 'Stadio del {c}'],
  },
  germanico: {
    id: 'germanico',
    firstStarts: ['Ber', 'Die', 'Ger', 'Ha', 'Jo', 'Kar', 'Lu', 'Mar', 'Ot', 'Ru', 'Ste', 'Til', 'Wal', 'Fe', 'Ul', 'Nik'],
    firstEnds: ['nd', 'ter', 'hard', 'nas', 'ko', 'lix', 'ian', 'rik', 'mo', 'las'],
    lastStarts: ['Al', 'Bau', 'Brand', 'Eck', 'Fisch', 'Hart', 'Kohl', 'Lang', 'Neu', 'Rein', 'Schu', 'Stein', 'Wag', 'Zim', 'Hol', 'Gröt'],
    lastEnds: ['mann', 'er', 'ke', 'berg', 'hoff', 'rich', 'ner', 'wald', 'feld', 'bach'],
    cityEnds: ['burg', 'stadt', 'heim', 'dorf', 'hausen', 'au', 'furt', 'ingen'],
    clubPatterns: ['FC {c}', 'SV {c}', '{c} 04', 'VfB {c}', 'TSV {c}', 'SC {c}', 'Eintracht {c}', 'Fortuna {c}', 'Borussia {c}'],
    stadiumPatterns: ['{c}er Arena', '{s}-Stadion', 'Waldstadion {c}', 'Arena {c}'],
  },
  lusofono: {
    id: 'lusofono',
    firstStarts: ['Ad', 'Br', 'Cai', 'Dan', 'Edu', 'Fel', 'Gu', 'Jo', 'Le', 'Mau', 'Ro', 'Ta', 'Vi', 'Wel', 'Ri', 'Ti'],
    firstEnds: ['ilson', 'uno', 'ão', 'inho', 'ar', 'iel', 'aldo', 'ique', 'son', 'ago'],
    lastStarts: ['Al', 'Bar', 'Car', 'Fon', 'Gou', 'Mach', 'Mor', 'Pin', 'Quei', 'Rib', 'San', 'Tei', 'Vas', 'Lob', 'Cun'],
    lastEnds: ['eira', 'inho', 'ado', 'oso', 'ão', 'ares', 'ues', 'alho', 'ela', 'ira'],
    cityEnds: ['ópolis', 'ense', 'eira', 'al', 'ana', 'ito', 'inha', 'ão'],
    clubPatterns: ['EC {c}', 'SC {c}', 'Clube {c}', '{c} FC', 'Associação {c}', 'Atlético {c}', 'União {c}'],
    stadiumPatterns: ['Estádio {s}', 'Estádio Municipal de {c}', 'Arena {c}', 'Estádio do {c}'],
  },
  franco: {
    id: 'franco',
    firstStarts: ['An', 'Bas', 'Cle', 'Did', 'Em', 'Flo', 'Gil', 'Hu', 'Jul', 'Lou', 'Mat', 'No', 'Pas', 'Re', 'Th', 'Yan'],
    firstEnds: ['ien', 'ard', 'ent', 'ois', 'el', 'ry', 'mo', 'ise', 'an', 'is'],
    lastStarts: ['Ber', 'Cha', 'Dur', 'Fav', 'Gir', 'Lam', 'Mor', 'Per', 'Rou', 'Tav', 'Vail', 'Bon', 'Dél', 'Mal', 'Ris'],
    lastEnds: ['eau', 'ier', 'ard', 'et', 'in', 'ot', 'and', 'ais', 'on', 'ac'],
    cityEnds: ['ville', 'mont', 'ac', 'ière', 'eaux', 'court', 'gny', 'oise'],
    clubPatterns: ['FC {c}', 'AS {c}', 'Stade {c}', 'Olympique {c}', 'RC {c}', 'US {c}', 'SC {c}', 'En Avant {c}'],
    stadiumPatterns: ['Stade {s}', 'Stade Municipal de {c}', 'Parc de {c}', 'Stade de la {s}'],
  },
  anglo: {
    id: 'anglo',
    firstStarts: ['Al', 'Ben', 'Cal', 'Dan', 'Ed', 'Fin', 'Har', 'Jak', 'Kie', 'Lew', 'Mas', 'Os', 'Ry', 'Sam', 'Tob', 'Will'],
    firstEnds: ['fie', 'by', 'ley', 'ton', 'ric', 'ard', 'an', 'son', 'ie', 'ey'],
    lastStarts: ['Ash', 'Brad', 'Chal', 'Dun', 'Fair', 'Hal', 'Kit', 'Mor', 'Pem', 'Rad', 'Shel', 'Thorn', 'Whit', 'Bram', 'Gild'],
    lastEnds: ['ford', 'ton', 'ley', 'wick', 'worth', 'by', 'more', 'field', 'well', 'den'],
    cityEnds: ['ford', 'ton', 'bury', 'chester', 'mouth', 'field', 'wick', 'pool'],
    clubPatterns: ['{c} United', '{c} Town', '{c} City', '{c} Rovers', '{c} Athletic', '{c} Wanderers', '{c} Albion', '{c} County'],
    stadiumPatterns: ['{s} Park', '{c} Road', '{s} Lane', 'The {s} Ground'],
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function firstName(rng: Rng, st: NameStyle): string {
  return cap(rng.pick(st.firstStarts) + rng.pick(st.firstEnds));
}

export function lastName(rng: Rng, st: NameStyle): string {
  const base = rng.pick(st.lastStarts) + rng.pick(st.lastEnds);
  return cap(base);
}

export function cityName(rng: Rng, st: NameStyle): string {
  const start = rng.chance(0.5) ? rng.pick(st.lastStarts) : rng.pick(st.firstStarts);
  return cap(start + rng.pick(st.cityEnds));
}

export function fill(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w)\}/g, (_, k: string) => vars[k] ?? '');
}
