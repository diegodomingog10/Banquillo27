"""
Convierte los datos reales (EA SPORTS FC 27 + Transfermarkt) en los CSV del importador.

Uso (desde la raíz del proyecto):
  python3 -I scripts/real/build_fc27.py [--fc27 ruta/players.csv] [--tm carpeta_transfermarkt]
                                        [--out data/real/import] [--scale-mid 62] [--scale-span 4.0]

- FC 27 manda en clubes, ligas, posiciones y atributos (instantánea de septiembre de 2026).
- Transfermarkt aporta altura, fin de contrato, valor de mercado e internacionalidades
  (cruce por fecha de nacimiento + apellido).
- Lo que no existe en EA (atributos mentales de Football Manager, ocultos) se estima a
  partir de los atributos de EA más cercanos, con una variación determinista por jugador.
- El potencial lo estima el importador (edad y nivel).

Los datos generados quedan en data/real/, que está en .gitignore: no se publican.
"""
import argparse
import collections
import csv
import hashlib
import json
import os
import re
import unicodedata

ap = argparse.ArgumentParser()
ap.add_argument('--fc27', default='data/real/fc27-kaggle/extracted/players.csv')
ap.add_argument('--tm', default='data/real/transfermarkt/extracted')
ap.add_argument('--out', default='data/real/import')
ap.add_argument('--manual', default='data/real/manual', help='carpeta con clubes añadidos a mano (*.json + CSV de plantilla)')
# Escala EA (1-99) -> juego (1-20): curva por tramos; --shift desplaza todos los valores EA (calibración)
ap.add_argument('--shift', type=float, default=0.0)
# Ajustes de calibración del motor (en puntos de la escala EA)
ap.add_argument('--gk-shift', type=float, default=5.0, help='porteros: manejo, reflejos, uno contra uno, juego aéreo, colocación')
ap.add_argument('--def-shift', type=float, default=3.0, help='defensa: entradas, marcaje, colocación, juego de cabeza')
ap.add_argument('--move-shift', type=float, default=-4.0, help='regate, aceleración, velocidad, agilidad y equilibrio (EA los infla)')
ap.add_argument('--read-shift', type=float, default=4.0, help='anticipación y concentración (lectura del juego)')
args = ap.parse_args()

# ---------------------------------------------------------------- utilidades
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]', '', s).strip()

def slug(s):
    return re.sub(r'\s+', '_', norm(s))[:40] or 'x'

def h01(*parts):
    """Número determinista en [0, 1) a partir de un texto (sin azar real)."""
    d = hashlib.sha1('|'.join(map(str, parts)).encode()).digest()
    return int.from_bytes(d[:6], 'big') / 2 ** 48

def num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default

# Tramos (EA, juego): comprime los extremos como hace Football Manager
CURVE = [(1, 1), (15, 2), (30, 5), (50, 9), (70, 13), (85, 16.5), (95, 19.5), (99, 20)]

def to20(ea, extra=0.0):
    """EA 1-99 -> 1-20 (interpolación lineal entre tramos)."""
    if ea is None:
        return None
    x = max(1, min(99, ea + args.shift + extra))
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if x <= x1:
            return max(1, min(20, round(y0 + (y1 - y0) * (x - x0) / (x1 - x0))))
    return 20

def mix(*pairs):
    """Media ponderada de atributos EA ((valor, peso), ...), ignorando los que falten."""
    tot = sum(w for v, w in pairs if v is not None)
    if not tot:
        return None
    return sum(v * w for v, w in pairs if v is not None) / tot

def jitter(base, pid, key, spread=1.2):
    """Pequeña variación determinista para atributos estimados."""
    if base is None:
        return None
    return max(1, min(20, round(base + (h01(pid, key) - 0.5) * 2 * spread)))

def normal20(pid, key, mean, sd, lo=1, hi=20):
    # Aproximación de una normal con la media de tres uniformes deterministas
    u = (h01(pid, key, 1) + h01(pid, key, 2) + h01(pid, key, 3)) / 3
    return max(lo, min(hi, round(mean + (u - 0.5) * sd * 4.2)))

# ---------------------------------------------------------------- ligas
# Liga EA -> (país, nivel, nombre a mostrar)
LEAGUES = {
    'Premier League': ('England', 1, 'Premier League'),
    'EFL Championship': ('England', 2, 'EFL Championship'),
    'EFL League One': ('England', 3, 'EFL League One'),
    'EFL League Two': ('England', 4, 'EFL League Two'),
    'LALIGA EA SPORTS': ('Spain', 1, 'LaLiga'),
    'LALIGA HYPERMOTION': ('Spain', 2, 'LaLiga Hypermotion'),
    'Serie A Enilive': ('Italy', 1, 'Serie A'),
    'Serie BKT': ('Italy', 2, 'Serie B'),
    'Bundesliga': ('Germany', 1, 'Bundesliga'),
    'Bundesliga 2': ('Germany', 2, '2. Bundesliga'),
    '3. Liga': ('Germany', 3, '3. Liga'),
    "Ligue 1 McDonald's": ('France', 1, 'Ligue 1'),
    'Ligue 2 BKT': ('France', 2, 'Ligue 2'),
    'Liga Portugal': ('Portugal', 1, 'Liga Portugal'),
    'Eredivisie': ('Holland', 1, 'Eredivisie'),
    '1A Pro League': ('Belgium', 1, 'Pro League'),
    'Trendyol Süper Lig': ('Turkey', 1, 'Süper Lig'),
    'Scottish Premiership': ('Scotland', 1, 'Scottish Premiership'),
    'Ö. Bundesliga': ('Austria', 1, 'Bundesliga de Austria'),
    'Brack Super League': ('Switzerland', 1, 'Super League de Suiza'),
    'Metropolitan Division': ('Denmark', 1, 'Superliga de Dinamarca'),
    'Eliteserien': ('Norway', 1, 'Eliteserien'),
    'Allsvenskan': ('Sweden', 1, 'Allsvenskan'),
    'Ekstraklasa': ('Poland', 1, 'Ekstraklasa'),
    'SUPERLIGA': ('Romania', 1, 'Superliga de Rumanía'),
    "SSE Airtricity Men's Premier Division": ('Republic of Ireland', 1, 'Premier Division de Irlanda'),
    'ROSHN Saudi League': ('Saudi Arabia', 1, 'Saudi Pro League'),
    'MLS': ('United States', 1, 'MLS'),
    'Liga BBVA MX': ('Mexico', 1, 'Liga MX'),
    'LPF': ('Argentina', 1, 'Liga Profesional Argentina'),
    'K League 1': ('Korea Republic', 1, 'K League 1'),
    'CSL': ('China PR', 1, 'Superliga China'),
    'Isuzu UTE A League': ('Australia', 1, 'A-League'),
    'ISL': ('India', 1, 'Indian Super League'),
    # No está en EA: la forman los clubes añadidos a mano (data/real/manual)
    'PRIMERA FEDERACIÓN': ('Spain', 3, 'Primera Federación'),
}
# Ascensos y descensos entre divisiones del mismo país (descienden/ascienden)
MOVES = {('England', 1): 3, ('England', 2): 3, ('England', 3): 4, ('Spain', 1): 3, ('Spain', 2): 4, ('Italy', 1): 3,
         ('Germany', 1): 2, ('Germany', 2): 2, ('France', 1): 2}
# Ligas parciales o de un solo club en EA: sus clubes existen pero no juegan liga
PARTIAL_COUNTRY = {
    'Hellas Liga': 'Greece', 'Česká Liga': 'Czech Republic', 'Ukrayina Liha': 'Ukraine', 'Liga Hrvatska': 'Croatia',
    'Liga Cyprus': 'Cyprus', 'United Emirates League': 'United Arab Emirates', 'Liga do Brasil': 'Brazil',
    'Magyar Liga': 'Hungary', 'Liga Colombia': 'Colombia', 'Liga Bulgaria': 'Bulgaria', 'Liga Azerbaijan': 'Azerbaijan',
    'Thailand League': 'Thailand', 'Finnliiga': 'Finland',
}
CONTINENT = {
    'Argentina': 'América del Sur', 'Brazil': 'América del Sur', 'Colombia': 'América del Sur', 'Chile': 'América del Sur',
    'Uruguay': 'América del Sur', 'Paraguay': 'América del Sur', 'Peru': 'América del Sur', 'Ecuador': 'América del Sur',
    'Bolivia': 'América del Sur', 'Venezuela': 'América del Sur', 'United States': 'América del Norte', 'Mexico': 'América del Norte',
    'Canada': 'América del Norte', 'Saudi Arabia': 'Asia', 'Korea Republic': 'Asia', 'China PR': 'Asia', 'India': 'Asia',
    'Japan': 'Asia', 'Thailand': 'Asia', 'United Arab Emirates': 'Asia', 'Qatar': 'Asia', 'Australia': 'Oceanía',
    'Azerbaijan': 'Europa',
}

# ---------------------------------------------------------------- carga
fc = [r for r in csv.DictReader(open(args.fc27, newline='', encoding='utf-8-sig')) if r['gender'] == "Men's Football"]
# Nombres inventados o abreviados de EA (clubes sin licencia) -> nombre real
ALIASES = {
    'Lombardia FC': 'Inter', 'Milano FC': 'AC Milan', 'Bergamo Calcio': 'Atalanta', 'Latium': 'Lazio',
    'Man Utd': 'Manchester United', 'Spurs': 'Tottenham Hotspur', "M'gladbach": 'Borussia Mönchengladbach',
    'OL': 'Olympique de Lyon', 'OM': 'Olympique de Marsella', 'Wolves': 'Wolverhampton Wanderers', 'QPR': 'Queens Park Rangers',
    'LAFC': 'Los Angeles FC', 'STVV': 'Sint-Truiden', 'Hearts': 'Heart of Midlothian', 'R. Racing Club': 'Racing de Santander',
}
for r in fc:
    r['club'] = ALIASES.get(r['club'], r['club'])
# Clubes con el mismo nombre en ligas distintas (p. ej. Nacional de Portugal y de Uruguay): se separan
_leagues_of = collections.defaultdict(set)
for r in fc:
    _leagues_of[r['club']].add(r['league'])
_nat_of = collections.defaultdict(collections.Counter)
for r in fc:
    if len(_leagues_of[r['club']]) > 1 and r['league'] not in LEAGUES:
        _nat_of[(r['club'], r['league'])][r['nationality']] += 1
for r in fc:
    k = (r['club'], r['league'])
    if k in _nat_of:
        r['club'] = f"{r['club']} ({_nat_of[k].most_common(1)[0][0]})"
# ---------------------------------------------------------------- clubes añadidos a mano
# Cada *.json de --manual describe un club que EA no tiene (p. ej. Real Zaragoza): liga, club al que
# sustituye (pasa a no tener liga), estadio, equipación y un CSV con la plantilla (posiciones y nivel EA).
ES_NAT = {'España': 'Spain', 'Países Bajos': 'Holland', 'Rumanía': 'Romania', 'Nigeria': 'Nigeria', 'Ghana': 'Ghana',
          'Ecuador': 'Ecuador', 'República Dominicana': 'Dominican Republic', 'Argentina': 'Argentina', 'Francia': 'France',
          'Portugal': 'Portugal', 'Italia': 'Italy', 'Alemania': 'Germany', 'Inglaterra': 'England', 'Uruguay': 'Uruguay',
          'Colombia': 'Colombia', 'Brasil': 'Brazil', 'Marruecos': 'Morocco', 'Senegal': 'Senegal', 'Eslovaquia': 'Slovakia'}
def read_roster(spec):
    """Plantilla de un club: un CSV o una hoja de un Excel («libro.xlsx#Hoja»). Devuelve (filas, categorías)."""
    if '.xlsx' not in spec:
        return list(csv.DictReader(open(os.path.join(args.manual, spec), newline='', encoding='utf-8'))), {}, {}
    import datetime
    from openpyxl import load_workbook
    book, sheet = spec.split('#', 1)
    wb = load_workbook(os.path.join(args.manual, book), data_only=True)
    def table(ws):
        it = ws.iter_rows(values_only=True)
        head = [str(h).strip() if h is not None else '' for h in next(it)]
        out = []
        for vals in it:
            if all(v is None or v == '' for v in vals):
                continue
            row = {}
            for h, v in zip(head, vals):
                if isinstance(v, (datetime.datetime, datetime.date)):
                    v = v.strftime('%Y-%m-%d')
                elif isinstance(v, float) and v.is_integer():
                    v = int(v)
                row[h] = '' if v is None else str(v).strip()
            out.append(row)
        return out
    perfiles = {}
    if 'Perfiles' in wb.sheetnames:
        for c in table(wb['Perfiles']):
            if c.get('perfil'):
                perfiles[c['perfil']] = (c.get('grupo', ''), [float(c.get(f) or 0) for f in ('ritmo', 'tiro', 'pase', 'regate', 'defensa', 'fisico')])
    cats = {}
    if 'Categorías' in wb.sheetnames:
        for c in table(wb['Categorías']):
            if c.get('categoria'):
                cats[c['categoria']] = (float(c['nivel_base']), float(c['partidos_liga']))
    return [r for r in table(wb[sheet]) if r.get('nombre')], cats, perfiles

MANUAL = []
if os.path.isdir(args.manual):
    for fn in sorted(os.listdir(args.manual)):
        if fn.endswith('.json'):
            m = json.load(open(os.path.join(args.manual, fn), encoding='utf-8'))
            m['rows'], m['cats'], m['perfiles'] = read_roster(m['jugadores'])
            MANUAL.append(m)
manual_extra = []  # jugadores sin datos de EA: se crean con nivel objetivo
manual_clubs = {m['club']: m for m in MANUAL}
fc_by_dob = collections.defaultdict(list)
for r in fc:
    fc_by_dob[r['birthdate']].append(r)
for m in MANUAL:
    for r in fc:
        if r['club'] == m.get('sustituye_a'):
            r['league'] = 'SIN LIGA:' + m['pais']
    for row in m['rows']:
        toks = [t for t in norm(row['nombre']).split() if len(t) > 2]
        hit = [r for r in fc_by_dob.get(row['nacimiento'], []) if any(t in norm(r['first_name'] + ' ' + r['last_name'] + ' ' + r['common_name']) for t in toks)]
        if len(hit) == 1:
            hit[0]['club'] = m['club']
            hit[0]['league'] = m['liga_ea']
            if num(row.get('nivel_ea')) is not None:
                hit[0]['_force'] = num(row.get('nivel_ea'))
            if (row.get('rasgos') or '').strip():
                hit[0]['_tags_row'] = row
        else:
            manual_extra.append((m, row))

tm_players = list(csv.DictReader(open(os.path.join(args.tm, 'players.csv'), newline='', encoding='utf-8')))
tm_clubs = {c['club_id']: c for c in csv.DictReader(open(os.path.join(args.tm, 'clubs.csv'), newline='', encoding='utf-8'))}

by_dob = collections.defaultdict(list)
for t in tm_players:
    d = (t['date_of_birth'] or '')[:10]
    if d:
        by_dob[d].append(t)

def tm_match(r):
    cands = by_dob.get(r['birthdate'], [])
    if not cands:
        return None
    key = norm(r['last_name']).split()[-1] if norm(r['last_name']) else norm(r['common_name'])
    m = [t for t in cands if key and key in norm(t['name'])]
    if len(m) == 1:
        return m[0]
    # Con varios candidatos, el que tenga también el nombre
    fn = norm(r['first_name']).split()[0] if norm(r['first_name']) else ''
    m2 = [t for t in m if fn and fn in norm(t['name'])]
    return m2[0] if len(m2) == 1 else None

# ---------------------------------------------------------------- clubes y su país
club_players = collections.defaultdict(list)
for r in fc:
    club_players[r['club']].append(r)

def club_country(club, league):
    if league in LEAGUES:
        return LEAGUES[league][0]
    if league in PARTIAL_COUNTRY:
        return PARTIAL_COUNTRY[league]
    if league.startswith('SIN LIGA:'):
        return league.split(':', 1)[1]
    # Grupos CONMEBOL de EA: país más frecuente entre sus jugadores
    return collections.Counter(p['nationality'] for p in club_players[club]).most_common(1)[0][0]

club_league = {}
for r in fc:
    club_league.setdefault(r['club'], r['league'])
for m in MANUAL:
    club_league[m['club']] = m['liga_ea']
    club_players.setdefault(m['club'], [])

# ---------------------------------------------------------------- jugadores
POS = {'GK': 'GK', 'CB': 'CB', 'LB': 'LB', 'RB': 'RB', 'LWB': 'LWB', 'RWB': 'RWB', 'CDM': 'DM', 'CM': 'CM', 'CAM': 'AM',
       'LM': 'LM', 'RM': 'RM', 'LW': 'LW', 'RW': 'RW', 'ST': 'ST', 'CF': 'ST'}

ATTR_COLS = ['corners', 'crossing', 'dribbling', 'finishing', 'firstTouch', 'freeKicks', 'heading', 'longShots', 'longThrows',
             'marking', 'passing', 'penalties', 'tackling', 'technique', 'aggression', 'anticipation', 'bravery', 'composure',
             'concentration', 'decisions', 'determination', 'flair', 'offTheBall', 'leadership', 'positioning', 'teamwork',
             'vision', 'workRate', 'acceleration', 'agility', 'balance', 'jumping', 'naturalFitness', 'pace', 'stamina',
             'strength', 'aerialReach', 'communication', 'handling', 'kicking', 'reflexes', 'oneOnOnes', 'playWithFeet',
             'consistency', 'importantMatches', 'injuryProneness', 'versatility', 'ambition', 'loyalty', 'professionalism',
             'temperament']

def attrs_of(r, age):
    g = lambda k: num(r.get(k))
    pid = r['player_id']
    cross, fin, head, sp, vol = g('attacking_crossing'), g('attacking_finishing'), g('attacking_heading_accuracy'), g('attacking_short_passing'), g('attacking_volleys')
    dri, curve, fk, lp, bc = g('skill_dribbling'), g('skill_curve'), g('skill_fk_accuracy'), g('skill_long_passing'), g('skill_ball_control')
    acc, spd, agi, rea, bal = g('movement_acceleration'), g('movement_sprint_speed'), g('movement_agility'), g('movement_reactions'), g('movement_balance')
    shp, jum, sta, stg, ls = g('power_shot_power'), g('power_jumping'), g('power_stamina'), g('power_strength'), g('power_long_shots')
    agg, inte, posi, vis, pen, comp = g('mentality_aggression'), g('mentality_interceptions'), g('mentality_positioning'), g('mentality_vision'), g('mentality_penalties'), g('mentality_composure')
    awa, stt, slt = g('defending_awareness'), g('defending_standing_tackle'), g('defending_sliding_tackle')
    gdiv, ghan, gkic, gpos, gref = g('goalkeeping_diving'), g('goalkeeping_handling'), g('goalkeeping_kicking'), g('goalkeeping_positioning'), g('goalkeeping_reflexes')
    sm, wf = num(r.get('skill_moves'), 2), num(r.get('weak_foot'), 3)
    ovr = num(r['overall_rating'], 60)
    is_gk = r['position'] == 'GK'
    a = {
        'corners': to20(mix((cross, 1), (curve, 1))),
        'crossing': to20(cross),
        'dribbling': to20(dri, args.move_shift),
        'finishing': to20(fin),
        'firstTouch': to20(bc),
        'freeKicks': to20(fk),
        'heading': to20(head, args.def_shift / 2),
        'longShots': to20(mix((ls, 2), (shp, 1))),
        'longThrows': jitter(to20(mix((stg, 1), (lp, 1))), pid, 'lt', 2.5),
        'marking': to20(mix((awa, 2), (stt, 1)), args.def_shift),
        'passing': to20(mix((sp, 3), (lp, 2), (vis, 1))),
        'penalties': to20(pen),
        'tackling': to20(mix((stt, 3), (slt, 2)), args.def_shift),
        'technique': to20(mix((bc, 2), (dri, 1), (curve, 1))),
        'aggression': to20(agg),
        'anticipation': to20(mix((rea, 3), (inte, 1), (posi, 1)), args.read_shift),
        'bravery': jitter(to20(mix((agg, 2), (stg, 1), (head, 1))), pid, 'brv'),
        'composure': to20(comp),
        'concentration': jitter(to20(mix((awa, 1), (comp, 1), (rea, 1)), args.read_shift), pid, 'con'),
        'decisions': to20(mix((rea, 2), (vis, 1), (comp, 2))),
        'determination': normal20(pid, 'det', 11 + (ovr - 65) / 10, 3),
        'flair': jitter(to20(mix((dri, 2), (curve, 1), (vis, 1), (40 + sm * 10, 2))), pid, 'fla'),
        'offTheBall': to20(posi),
        'leadership': normal20(pid, 'lea', 6 + max(0, age - 22) * 0.55 + (ovr - 65) / 8, 3),
        'positioning': to20(mix((awa, 3), (inte, 2)), args.def_shift),
        'teamwork': jitter(to20(mix((sp, 1), (sta, 1), (awa, 1), (rea, 1))), pid, 'tea', 1.8),
        'vision': to20(vis),
        'workRate': jitter(to20(mix((sta, 2), (agg, 1), (inte, 1))), pid, 'wor', 1.5),
        'acceleration': to20(acc, args.move_shift),
        'agility': to20(agi, args.move_shift),
        'balance': to20(bal, args.move_shift),
        'jumping': to20(jum),
        'naturalFitness': jitter(to20(mix((sta, 2), (stg, 1))) if not is_gk else normal20(pid, 'nf', 11, 3), pid, 'nfit', 1.5),
        'pace': to20(spd, args.move_shift),
        'stamina': to20(sta),
        'strength': to20(stg),
        'handling': to20(ghan, args.gk_shift),
        'kicking': to20(gkic),
        'reflexes': to20(gref, args.gk_shift),
        'oneOnOnes': to20(mix((gdiv, 1), (gref, 1)), args.gk_shift),
        'aerialReach': to20(mix((gpos, 1), (jum, 1), (ghan, 1))),
        'communication': jitter(to20(mix((gpos, 2), (comp, 1))), pid, 'com'),
        'playWithFeet': to20(mix((gkic, 1), (sp, 1))),
    }
    if is_gk:
        # Porteros: los atributos mentales de EA son de jugador de campo (muy bajos); se toman de su juego de portero
        a['positioning'] = to20(gpos, args.gk_shift)
        a['composure'] = to20(mix((gpos, 2), (rea, 1), (comp, 1)))
        a['concentration'] = jitter(to20(mix((gpos, 1), (rea, 2))), pid, 'con')
        a['decisions'] = to20(mix((rea, 2), (gpos, 1)))
        a['anticipation'] = to20(mix((rea, 2), (gpos, 1)))
        a['aerialReach'] = to20(mix((ghan, 2), (gpos, 1), (gdiv, 1)), args.gk_shift)
        a['communication'] = jitter(to20(mix((gpos, 2), (rea, 1))), pid, 'com')
        a['bravery'] = jitter(to20(mix((gdiv, 1), (rea, 1))), pid, 'brv')
        a['teamwork'] = jitter(to20(mix((gpos, 1), (rea, 1))), pid, 'tea', 1.8)
    if not is_gk:
        # De campo: los de portero, bajos
        for k in ('handling', 'kicking', 'reflexes', 'oneOnOnes', 'aerialReach', 'communication', 'playWithFeet'):
            a[k] = normal20(pid, 'gk' + k, 2, 0.7, 1, 4)
    alts = [p for p in (r.get('alternate_positions') or '').split() if p]
    # Ocultos (estimados)
    a.update({
        'consistency': normal20(pid, 'cst', 9 + (ovr - 60) / 6, 3),
        'importantMatches': normal20(pid, 'imp', 10 + (ovr - 65) / 8, 3),
        'injuryProneness': normal20(pid, 'inj', 8 + max(0, age - 29) * 0.4, 3),
        'versatility': normal20(pid, 'ver', 7 + len(alts) * 2.5, 2.5),
        'ambition': normal20(pid, 'amb', 12 + (ovr - 65) / 10 - max(0, age - 30) * 0.3, 3),
        'loyalty': normal20(pid, 'loy', 11, 4),
        'professionalism': normal20(pid, 'pro', 11 + (ovr - 65) / 12 + (1 if age >= 28 else 0), 3.5),
        'temperament': normal20(pid, 'tem', 12 - ((agg or 55) - 55) / 15, 3),
    })
    return a, alts, wf

def positions_of(r, alts):
    main = POS.get(r['position'], 'CM')
    out = [main]
    for p in alts:
        c = POS.get(p)
        if c and c not in out:
            out.append(c)
    return ';'.join([out[0]] + [f'{p}:15' for p in out[1:]])

# Edad en la fecha de inicio de la partida (1 de julio de 2026)
REF = (2026, 7, 1)
def age_at(dob):
    y, m, d = (int(x) for x in dob.split('-'))
    return REF[0] - y - ((REF[1], REF[2]) < (m, d))

EA_DETAIL = [k for k in fc[0] if k.split('_')[0] in ('attacking', 'skill', 'movement', 'power', 'mentality', 'defending', 'goalkeeping')]

def shift_ea_row(r, level):
    """Jugador de EA con nivel forzado en el Excel: sube o baja sus atributos (los de portero, si es portero) hasta ese nivel."""
    delta = level - num(r['overall_rating'], level)
    gk = r['position'] == 'GK'
    for k in EA_DETAIL:
        use = (k.startswith('goalkeeping') or k == 'movement_reactions') if gk else not k.startswith('goalkeeping')
        if use:
            v = num(r.get(k))
            if v is not None:
                r[k] = str(max(1, min(99, round(v + delta))))
    r['overall_rating'] = str(level)

players_out = []
matched = 0
for r in fc:
    dob = r['birthdate']
    age = age_at(dob) if dob else 26
    if r.get('_force'):
        shift_ea_row(r, r['_force'])
    a, alts, wf = attrs_of(r, age)
    t = tm_match(r)
    if t:
        matched += 1
    strong = 20
    weak = max(1, min(20, int(wf * 4)))
    left_foot = r['preferred_foot'].lower().startswith('l')
    row = {
        'id': f"ea_{r['player_id']}",
        'first_name': r['first_name'] or r['common_name'] or r['last_name'],
        'last_name': r['last_name'] or r['common_name'] or r['first_name'],
        'common_name': r['common_name'],
        'birth_date': dob,
        'nationality': r['nationality'],
        'height_cm': (t['height_in_cm'] if t and t['height_in_cm'] else ''),
        'foot': 'left' if left_foot else 'right',
        'foot_left': strong if left_foot else weak,
        'foot_right': weak if left_foot else strong,
        'club_id': f"cl_{slug(r['club'])}",
        'positions': positions_of(r, alts),
        'market_value': (t['market_value_in_eur'] if t and t['market_value_in_eur'] else ''),
        # Contratos que ya vencieron antes del verano: se dejan para que el importador los estime
        'contract_expires': (t['contract_expiration_date'][:10] if t and t['contract_expiration_date'] and t['contract_expiration_date'][:10] >= '2027-06-30' else ''),
        'external_id': f"ea:{r['player_id']}" + (f";tm:{t['player_id']}" if t else ''),
    }
    row.update({k: a.get(k) for k in ATTR_COLS})
    players_out.append(row)

# Jugadores añadidos a mano sin datos de EA: nivel EA -> CA objetivo (relación media de la base real)
LEVEL_TO_CA = [(45, 80), (50, 86), (55, 94), (58, 100), (60, 104), (62, 108), (64, 113), (66, 117), (68, 120), (70, 125), (75, 135), (80, 146)]
def level_ca(level):
    for (x0, y0), (x1, y1) in zip(LEVEL_TO_CA, LEVEL_TO_CA[1:]):
        if level <= x1:
            return round(y0 + (y1 - y0) * (max(level, x0) - x0) / (x1 - x0))
    return LEVEL_TO_CA[-1][1]

def manual_level(m, row):
    """Nivel EA de un jugador añadido a mano: nivel_ea > estadísticas de la última temporada > nivel_estimado."""
    forced = num(row.get('nivel_ea'))
    if forced is not None:
        return forced, 'manual'
    cat = m['cats'].get(row.get('categoria', ''))
    mins = num(row.get('minutos'), 0)
    if cat and mins >= 270:
        base, games = cat
        share = min(1, mins / (games * 90))
        lvl = base - 5 + 7 * min(1, share / 0.66)
        main = (row.get('posiciones') or '').split(';')[0].strip()
        if main in ('AM', 'LW', 'RW', 'ST'):
            lvl += min(3, 6 * (num(row.get('goles'), 0) + num(row.get('asistencias'), 0)) * 90 / mins)
        if row.get('nacimiento') and share >= 0.5 and age_at(row['nacimiento']) <= 20:
            lvl += 1
        return int(lvl + 0.5), 'estadísticas'
    est = num(row.get('nivel_estimado'))
    return (est if est is not None else 60), 'estimado'

# ---------------------------------------------------------------- perfil detallado de los jugadores añadidos a mano
# Cada jugador toma los atributos detallados de los 15 jugadores de EA más parecidos: misma demarcación y
# valores de carta (ritmo, tiro, pase, regate, defensa, físico) y altura cercanos, corregidos a su nivel.
# Así un lateral ofensivo se parece a los laterales ofensivos reales de EA y no a una plantilla genérica.
import numpy as np
FACES = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality']
FACE_ES = ['ritmo', 'tiro', 'pase', 'regate', 'defensa', 'fisico']
GROUP = {'GK': 'GK', 'CB': 'CB', 'LB': 'FB', 'RB': 'FB', 'LWB': 'FB', 'RWB': 'FB', 'CDM': 'DM', 'DM': 'DM', 'CM': 'CM', 'CAM': 'AM',
         'AM': 'AM', 'LM': 'W', 'RM': 'W', 'LW': 'W', 'RW': 'W', 'ST': 'ST', 'CF': 'ST'}
EA_CODE = {'DM': 'CDM', 'AM': 'CAM'}
POOL = {}
DCOEF = {}
_by_group = collections.defaultdict(list)
for r in fc:
    if r['pace'] and r['overall_rating']:
        _by_group[GROUP.get(r['position'], 'CM')].append(r)
for g, rs in _by_group.items():
    X = np.array([[num(r[f], 50) for f in FACES] for r in rs], float)
    y = np.array([num(r['overall_rating'], 60) for r in rs], float)
    H = np.array([num(r.get('height_cm'), np.nan) for r in rs], float)
    D = np.array([[num(r.get(k), 50) for k in EA_DETAIL] for r in rs], float)
    coef = np.linalg.lstsq(np.c_[np.ones(len(X)), X], y, rcond=None)[0]
    SM = np.array([num(r['skill_moves'], 2) for r in rs], float)
    WF = np.array([num(r['weak_foot'], 3) for r in rs], float)
    POOL[g] = (X, y, H, D, coef, SM, WF)
    # Media de EA en función de los 34 atributos detallados (para reequilibrar tras aplicar rasgos)
    DCOEF[g] = np.linalg.lstsq(np.c_[np.ones(len(D)), D], y, rcond=None)[0]

# Rasgos (columna «rasgos» del Excel, separados por comas). Intensidad: «x» +1, «++x» +2, «-x» −1, «--x» −2.
# Un paso son 7 puntos EA (≈ 1,5 en la escala 1-20 del juego) en los atributos relacionados; después se reequilibra
# el resto para que la media del jugador siga siendo su nivel.
TAG_EA = {
    'velocidad': ['movement_acceleration', 'movement_sprint_speed'], 'agilidad': ['movement_agility', 'movement_balance'],
    'regate': ['skill_dribbling', 'movement_agility', 'skill_ball_control'], 'tecnica': ['skill_ball_control', 'skill_dribbling', 'skill_curve', 'attacking_short_passing'],
    'centros': ['attacking_crossing', 'skill_curve'], 'cabeza': ['attacking_heading_accuracy', 'power_jumping'],
    'remate': ['attacking_finishing', 'attacking_volleys', 'mentality_positioning'], 'disparo lejano': ['power_long_shots', 'power_shot_power'],
    'pase': ['attacking_short_passing', 'skill_long_passing'], 'vision': ['mentality_vision', 'skill_long_passing'],
    'ultimo pase': ['mentality_vision', 'attacking_short_passing'], 'faltas': ['skill_fk_accuracy', 'skill_curve'], 'penaltis': ['mentality_penalties'],
    'entradas': ['defending_standing_tackle', 'defending_sliding_tackle', 'mentality_interceptions'],
    'colocacion': ['defending_awareness', 'mentality_interceptions'],
    'tactica': ['defending_awareness', 'mentality_interceptions', 'mentality_positioning', 'movement_reactions'],
    'decisiones': ['movement_reactions', 'mentality_composure', 'mentality_vision'], 'desmarque': ['mentality_positioning', 'movement_reactions'],
    'compostura': ['mentality_composure'], 'fuerza': ['power_strength'], 'fisico': ['power_strength', 'power_stamina', 'power_jumping'],
    'resistencia': ['power_stamina'], 'agresivo': ['mentality_aggression'],
    'reflejos': ['goalkeeping_reflexes', 'goalkeeping_diving'], 'juego de pies': ['goalkeeping_kicking', 'attacking_short_passing', 'skill_long_passing'],
    'blocaje': ['goalkeeping_handling'], 'por alto': ['goalkeeping_handling', 'goalkeeping_positioning', 'power_jumping'],
    'colocacion portero': ['goalkeeping_positioning'],
}
TAG_ALIAS = {'robos': 'entradas', 'corte': 'entradas', 'juego aereo': 'cabeza', 'gol': 'remate', 'definicion': 'remate', 'posicionamiento': 'colocacion',
             'recorrido': 'resistencia', 'liderazgo': 'lider', 'lesiones': 'fragil', 'rapido': 'velocidad', 'uno contra uno': 'reflejos', '1vs1': 'reflejos',
             'temperamento': 'temperamental'}
TAG_FM = {'lider': {'leadership': 4}, 'personalidad': {'leadership': 2, 'importantMatches': 3, 'determination': 2},
          'trabajador': {'workRate': 3, 'teamwork': 2}, 'caracter': {'determination': 3, 'bravery': 2}, 'profesional': {'professionalism': 3},
          'regular': {'consistency': 3}, 'irregular': {'consistency': -3}, 'fragil': {'injuryProneness': 4}, 'polivalente': {'versatility': 4},
          'competitivo': {'importantMatches': 3, 'determination': 2}, 'temperamental': {'temperament': -4}, 'agresivo': {'aggression': 2},
          'experiencia': {'importantMatches': 2, 'composure': 1}}
TAG_STEP = 7

def tags_of(row):
    out = []
    for t in (row.get('rasgos') or '').split(','):
        t = t.strip()
        if not t or '=' in t:
            continue
        k = len(t) - len(t.lstrip('+-'))
        sign = (-1 if t.startswith('-') else 1) * max(1, k)
        name = norm(t.lstrip('-+ '))
        out.append((TAG_ALIAS.get(name, name), sign))
    return out

def apply_tags(det, tags, level, group):
    """Aplica los rasgos a los atributos detallados (escala EA). El reequilibrio para mantener el nivel se hace
    después, en la escala del juego (rebalance_ca), que es la que cuenta para la CA."""
    col = {k: i for i, k in enumerate(EA_DETAIL)}
    for tag, sign in tags:
        for k in TAG_EA.get(tag, []):
            det[col[k]] += sign * TAG_STEP
    return np.clip(det, 1, 99)

def fixed_of(row):
    """Valores fijos en la escala del juego: «fuerza=19» fija los atributos de ese rasgo a 19."""
    out = {}
    for t in (row.get('rasgos') or '').split(','):
        if '=' in t:
            k, v = t.split('=', 1)
            name = norm(k.strip())
            out[TAG_ALIAS.get(name, name)] = num(v.strip())
    return {k: v for k, v in out.items() if v is not None}

def apply_fixed(a, fixed):
    for tag, v in fixed.items():
        for k in TAG_GAME_ATTRS.get(tag, []):
            a[k] = int(max(1, min(20, round(v))))

def apply_fm_tags(a, tags):
    for tag, sign in tags:
        for k, v in TAG_FM.get(tag, {}).items():
            if k in a:
                a[k] = max(1, min(20, round(a[k] + sign * v)))

# Habilidad actual (CA) con la misma fórmula que el juego (pesos de src/data/ability.ts)
import subprocess
_caw = json.loads(subprocess.run(['npx', 'tsx', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ca_weights.ts')],
                                 capture_output=True, text=True, check=True).stdout)

def game_ca(a, main):
    w = _caw['weights'][_caw['groupOf'].get(main, 'CM')]
    keys = [k for k, v in w.items() if v > 0]
    return 10 * sum(w[k] * a[k] for k in keys) / sum(w[k] for k in keys)

# Atributos del juego (1-20) ligados a cada rasgo: no se tocan al reequilibrar, para que los puntos
# fuertes sigan siéndolo y los débiles sigan siéndolo; el ajuste recae en el resto.
TAG_GAME_ATTRS = {
    'velocidad': ['pace', 'acceleration'], 'agilidad': ['agility', 'balance'], 'regate': ['dribbling', 'agility'],
    'tecnica': ['technique', 'firstTouch'], 'centros': ['crossing'], 'cabeza': ['heading', 'jumping'], 'remate': ['finishing', 'offTheBall'],
    'disparo lejano': ['longShots'], 'pase': ['passing'], 'vision': ['vision'], 'ultimo pase': ['vision', 'passing'], 'faltas': ['freeKicks'],
    'penaltis': ['penalties'], 'entradas': ['tackling'], 'colocacion': ['positioning', 'marking'],
    'tactica': ['positioning', 'anticipation', 'decisions', 'offTheBall'], 'decisiones': ['decisions', 'composure'], 'desmarque': ['offTheBall'],
    'compostura': ['composure'], 'fuerza': ['strength'], 'fisico': ['strength', 'stamina', 'jumping'], 'resistencia': ['stamina'],
    'agresivo': ['aggression'], 'reflejos': ['reflexes', 'oneOnOnes'], 'juego de pies': ['kicking', 'playWithFeet'], 'blocaje': ['handling'],
    'por alto': ['aerialReach', 'handling'], 'colocacion portero': ['positioning'], 'lider': ['leadership'], 'trabajador': ['workRate', 'teamwork'],
}

def rebalance_ca(a, main, target, tags=()):
    """Desplaza por igual los atributos que cuentan para la CA (salvo los ligados a rasgos) hasta que la CA del
    juego sea `target`: los rasgos cambian el reparto de los atributos, no el nivel global."""
    w = _caw['weights'][_caw['groupOf'].get(main, 'CM')]
    protect = {k for tag, _ in tags for k in TAG_GAME_ATTRS.get(tag, [])}
    keys = [k for k, v in w.items() if v > 0 and k in a and k not in protect]
    total = sum(v for v in w.values() if v > 0)
    free = sum(w[k] for k in keys) or total
    vals = {k: float(a[k]) for k in keys}
    for _ in range(6):
        d = (target - game_ca({**a, **vals}, main)) / 10 * total / free
        vals = {k: min(20.0, max(1.0, v + d)) for k, v in vals.items()}
    for k in keys:
        a[k] = int(round(vals[k]))
    order = sorted(keys, key=lambda k: -w[k])
    for i in range(60):  # ajuste fino tras redondear
        diff = round(game_ca(a, main)) - round(target)
        if diff == 0:
            break
        k = order[i % len(order)]
        a[k] = max(1, min(20, a[k] - (1 if diff > 0 else -1)))

unknown_tags = collections.Counter()
def check_tags(tags, who):
    for tag, _ in tags:
        if tag not in TAG_EA and tag not in TAG_FM and tag not in TAG_GAME_ATTRS:
            unknown_tags[f'{tag} ({who})'] += 1

def player_faces(m, row, level, group):
    """Valores de carta del jugador: los del Excel o, si faltan, nivel + desplazamientos de su perfil; corregidos a su nivel."""
    perf = m['perfiles'].get(row.get('perfil', '')) or m['perfiles'].get(DEFAULT_PERFIL.get(group, ''))
    offs = perf[1] if perf else [0] * 6
    faces = np.array([num(row.get(f), level + o) for f, o in zip(FACE_ES, offs)], float)
    coef = POOL[group][4]
    faces += (level - (coef[0] + coef[1:] @ faces)) / coef[1:].sum()
    return np.clip(faces, 20, 99)

DEFAULT_PERFIL = {'GK': 'Portero equilibrado', 'CB': 'Central equilibrado', 'FB': 'Lateral equilibrado', 'DM': 'Pivote equilibrado',
                  'CM': 'Mediocentro equilibrado', 'AM': 'Mediapunta equilibrado', 'W': 'Extremo equilibrado', 'ST': 'Delantero equilibrado'}

def manual_template(m, row, level, pid, main, height, foot):
    """Fila «tipo EA» del jugador a partir de sus vecinos en la base de EA."""
    group = GROUP.get(main, 'CM')
    X, y, H, D, coef, SM, WF = POOL[group]
    faces = player_faces(m, row, level, group)
    d2 = ((X - faces) ** 2).sum(1)
    idx = np.argsort(d2)[:15]
    det = D[idx].mean(0) + (level - y[idx].mean())
    col = {k: i for i, k in enumerate(EA_DETAIL)}
    # EA FC 27 no trae la altura: un jugador más alto (o más bajo) que la media de su demarcación gana (o pierde) juego aéreo
    if height:
        dh = (height - HEIGHT_OF[group]) * 0.6
        for k in ('attacking_heading_accuracy', 'power_jumping'):
            det[col[k]] += dh
    det = apply_tags(det, tags_of(row), level, group)
    fake = {k: str(int(round(max(1, min(99, v))))) for k, v in zip(EA_DETAIL, det)}
    fake.update({f: str(int(round(v))) for f, v in zip(FACES, faces)})
    fake.update({'player_id': pid, 'overall_rating': str(level), 'position': EA_CODE.get(main, main),
                 'skill_moves': str(int(round(np.median(SM[idx])))), 'weak_foot': str(int(round(np.median(WF[idx])))),
                 'preferred_foot': 'Left' if foot == 'left' else 'Right'})
    if foot == 'both':
        fake['weak_foot'] = '5'
    return fake, HEIGHT_OF[group]

# Altura media por demarcación (Transfermarkt, jugadores con altura conocida)
_hs = collections.defaultdict(list)
_TM_GROUP = {'Goalkeeper': 'GK', 'Centre-Back': 'CB', 'Left-Back': 'FB', 'Right-Back': 'FB', 'Defensive Midfield': 'DM', 'Central Midfield': 'CM',
             'Attacking Midfield': 'AM', 'Left Winger': 'W', 'Right Winger': 'W', 'Left Midfield': 'W', 'Right Midfield': 'W',
             'Centre-Forward': 'ST', 'Second Striker': 'ST'}
for t in tm_players:
    h = num(t.get('height_in_cm'))
    if h and t.get('sub_position') in _TM_GROUP:
        _hs[_TM_GROUP[t['sub_position']]].append(h)
HEIGHT_OF = {g: float(np.median(v)) for g, v in _hs.items()}
for g in ('GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'):
    HEIGHT_OF.setdefault(g, 181.0)

FOOT_ES = {'zurdo': 'left', 'izquierdo': 'left', 'diestro': 'right', 'derecho': 'right', 'ambidiestro': 'both', 'ambos': 'both'}

# Jugadores de EA de un club manual con rasgos: se aplican sobre sus atributos reales, manteniendo su media
_out_by_id = {r['id']: r for r in players_out}
for r in fc:
    if r.get('_tags_row'):
        tags = tags_of(r['_tags_row'])
        check_tags(tags, r['_tags_row']['nombre'])
        g = GROUP.get(r['position'], 'CM')
        det = np.array([num(r.get(k), 50) for k in EA_DETAIL], float)
        det = apply_tags(det, tags, num(r['overall_rating'], 60), g)
        r.update({k: str(int(round(v))) for k, v in zip(EA_DETAIL, det)})
        main = POS.get(r['position'], 'CM')
        target = game_ca({k: num(v, 10) for k, v in _out_by_id[f"ea_{r['player_id']}"].items() if k in ATTR_COLS}, main)
        a, _, _ = attrs_of(r, age_at(r['birthdate']) if r['birthdate'] else 26)
        apply_fm_tags(a, tags)
        fixed = fixed_of(r['_tags_row'])
        apply_fixed(a, fixed)
        rebalance_ca(a, main, target, tags + [(k, 0) for k in fixed])
        _out_by_id[f"ea_{r['player_id']}"].update({k: a.get(k) for k in ATTR_COLS})

used_ids = set()
for m, row in manual_extra:
    toks = [t for t in norm(row['nombre']).split() if len(t) > 2]
    t = next((x for x in by_dob.get(row['nacimiento'], []) if any(tk in norm(x['name']) for tk in toks)), None)
    parts = row['nombre'].split()
    pos = [p.strip() for p in row['posiciones'].split(';') if p.strip()]
    level, _ = manual_level(m, row)
    pid = f"man_{slug(m['club'])}_{slug(row['nombre'])}"
    while pid in used_ids:
        pid += '_' + (row.get('dorsal') or 'x')
    used_ids.add(pid)
    height = num(row.get('altura_cm')) or (num(t['height_in_cm']) if t and t['height_in_cm'] else None)
    foot = FOOT_ES.get(norm(row.get('pie', '')).strip()) or (t['foot'] if t and t['foot'] in ('left', 'right', 'both') else None) \
        or ('left' if pos[0] in ('LB', 'LWB', 'LM') else 'right')
    fake, h_nb = manual_template(m, row, level, pid, pos[0], height, foot)
    a, _, wf = attrs_of(fake, age_at(row['nacimiento']) if row.get('nacimiento') else 26)
    check_tags(tags_of(row) + [(k, 0) for k in fixed_of(row)], row['nombre'])
    apply_fm_tags(a, tags_of(row))
    apply_fixed(a, fixed_of(row))
    rebalance_ca(a, pos[0], level_ca(level), tags_of(row) + [(k, 0) for k in fixed_of(row)])
    weak = max(1, min(20, int(wf * 4)))
    out = {k: '' for k in players_out[0]}
    out.update({k: a.get(k) for k in ATTR_COLS})
    out.update({
        'id': pid,
        'first_name': parts[0], 'last_name': ' '.join(parts[1:]) or parts[0], 'common_name': row['nombre'] if len(parts) == 1 else '',
        'birth_date': row['nacimiento'], 'nationality': ES_NAT.get(row['nacionalidad'], row['nacionalidad']),
        'height_cm': int(height or h_nb or 180),
        'foot': foot, 'foot_left': 20 if foot in ('left', 'both') else weak, 'foot_right': 20 if foot in ('right', 'both') else weak,
        'club_id': f"cl_{slug(m['club'])}",
        'positions': ';'.join([pos[0]] + [f'{q}:15' for q in pos[1:]]),
        'market_value': (t['market_value_in_eur'] if t and t['market_value_in_eur'] else ''),
        'contract_expires': f"{str(row['contrato'])[:4]}-06-30" if row.get('contrato') else '',
        'external_id': 'manual' + (f";tm:{t['player_id']}" if t else ''),
    })
    out['ca'] = ''  # el importador la calcula con los atributos, como para los jugadores de EA
    out['_level'] = level
    players_out.append(out)
for row in players_out:
    row.setdefault('ca', '')
    lvl = row.pop('_level', None)
    if lvl is not None:
        club_players[next(m['club'] for m in MANUAL if row['club_id'] == f"cl_{slug(m['club'])}")].append({'overall_rating': lvl})

# ---------------------------------------------------------------- clubes
def club_strength(club):
    rs = sorted((num(p['overall_rating'], 50) for p in club_players[club]), reverse=True)[:16]
    return sum(rs) / max(1, len(rs))

# Estadio desde Transfermarkt: club de TM más frecuente entre los jugadores cruzados
tm_by_ea_club = collections.defaultdict(collections.Counter)
for r, row in zip(fc, players_out):
    t = tm_match(r)
    if t and t['current_club_id']:
        tm_by_ea_club[r['club']][t['current_club_id']] += 1

strengths = {c: club_strength(c) for c in club_players}
smin, smax = min(strengths.values()), max(strengths.values())
clubs_out = []
for club, ps in club_players.items():
    lg = club_league[club]
    country = club_country(club, lg)
    s = strengths[club]
    # Reputación 500-9800 según el nivel medio de sus 16 mejores
    rep = round(500 + 9300 * ((s - smin) / (smax - smin)) ** 1.6)
    tmc = None
    if tm_by_ea_club[club]:
        cid, n = tm_by_ea_club[club].most_common(1)[0]
        if n >= 3:
            tmc = tm_clubs.get(cid)
    entry = {
        'id': f'cl_{slug(club)}', 'name': club, 'short_name': club[:20], 'nation': country,
        'league_id': f'lg_{slug(lg)}' if lg in LEAGUES else '',
        'reputation': rep,
        'stadium': (tmc['stadium_name'] if tmc and tmc['stadium_name'] else ''),
        'capacity': (tmc['stadium_seats'] if tmc and tmc['stadium_seats'] and tmc['stadium_seats'] != '0' else ''),
        'home_shirt': '', 'home_secondary': '', 'home_shorts': '', 'away_shirt': '', 'away_secondary': '', 'away_shorts': '',
        'home_pattern': '', 'away_pattern': '',
        'future_stadium_name': '', 'future_stadium_capacity': '', 'future_stadium_opens': '',
    }
    m = manual_clubs.get(club)
    if m:
        entry['stadium'] = m.get('estadio', '')
        entry['capacity'] = m.get('aforo', '')
        entry.update(m.get('equipacion', {}))
        fut = m.get('estadio_futuro')
        if fut:
            entry['future_stadium_name'] = fut.get('nombre', '')
            entry['future_stadium_capacity'] = fut.get('aforo', '')
            entry['future_stadium_opens'] = fut.get('apertura', '')
    clubs_out.append(entry)
# Reputación de los clubes añadidos a mano: la del club de referencia que indique su ficha
rep_by_name = {c['name']: c['reputation'] for c in clubs_out}
for c in clubs_out:
    m = manual_clubs.get(c['name'])
    if m and m.get('reputacion_como') in rep_by_name:
        c['reputation'] = rep_by_name[m['reputacion_como']]
    elif m and m.get('reputacion'):
        c['reputation'] = int(m['reputacion'])

# ---------------------------------------------------------------- naciones
nat_players = collections.defaultdict(list)
for r in fc:
    nat_players[r['nationality']].append(num(r['overall_rating'], 50))
league_strength = {}
for lg, (country, level, _) in LEAGUES.items():
    if level == 1:
        rs = [strengths[c] for c in club_players if club_league[c] == lg]
        league_strength[country] = sum(rs) / len(rs)
nations_out = []
countries = set(nat_players) | {c['nation'] for c in clubs_out}
lmin, lmax = min(league_strength.values()), max(league_strength.values())
for n in sorted(countries):
    top = sorted(nat_players.get(n, [50]), reverse=True)[:23]
    nat_rep = round(1000 + 8800 * max(0, (sum(top) / len(top) - 55) / 33))
    ls = league_strength.get(n)
    nations_out.append({
        'id': f'n_{slug(n)}', 'name': n, 'code': slug(n)[:3].upper(),
        'continent': CONTINENT.get(n, 'Europa' if n not in ('') else ''),
        'reputation': max(500, min(10000, nat_rep)),
        'league_strength': round(40 + 55 * (ls - lmin) / (lmax - lmin)) if ls else '',
        'mandatory_release_clause': 'sí' if n == 'Spain' else 'no',
    })
nat_id = {n['name']: n['id'] for n in nations_out}
for c in clubs_out:
    c['nation'] = nat_id[c['nation']]
for p in players_out:
    p['nationality'] = nat_id.get(p['nationality'], p['nationality'])

# ---------------------------------------------------------------- competiciones
comps_out = []
for lg, (country, level, name) in LEAGUES.items():
    cid = f'lg_{slug(lg)}'
    up = next((f'lg_{slug(l)}' for l, (c2, lv2, _) in LEAGUES.items() if c2 == country and lv2 == level - 1), '')
    down = next((f'lg_{slug(l)}' for l, (c2, lv2, _) in LEAGUES.items() if c2 == country and lv2 == level + 1), '')
    rs = [strengths[c] for c in club_players if club_league[c] == lg]
    comps_out.append({
        'id': cid, 'name': name, 'nation': nat_id[country], 'format': 'league', 'level': level,
        'reputation': round(1000 + 8800 * max(0, (sum(rs) / len(rs) - 58) / 22)),
        'start_date': '2026-08-15', 'end_date': '2027-05-30',
        'relegated': MOVES.get((country, level), 0) if down else 0,
        'promoted': MOVES.get((country, level - 1), 0) if up else 0,
        'up_competition_id': up, 'down_competition_id': down,
    })

# ---------------------------------------------------------------- escritura
os.makedirs(args.out, exist_ok=True)
def write(name, rows):
    with open(os.path.join(args.out, name), 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

write('nations.csv', nations_out)
write('competitions.csv', comps_out)
write('clubs.csv', clubs_out)
write('players.csv', players_out)
playing = sum(1 for c in clubs_out if c['league_id'])
print(f'Jugadores: {len(players_out)} ({matched} cruzados con Transfermarkt, {100 * matched / len(players_out):.0f} %)')
print(f'Clubes: {len(clubs_out)} ({playing} en ligas jugables, {len(clubs_out) - playing} sin liga)')
print(f'Ligas: {len(comps_out)} · Naciones: {len(nations_out)}')
print(f'Escala: curva por tramos {CURVE} con desplazamiento {args.shift:+}')
if unknown_tags:
    print('Rasgos no reconocidos (se ignoran):', ', '.join(unknown_tags))
for m in MANUAL:
    n_ea = sum(1 for r in fc if r['club'] == m['club'])
    n_man = sum(1 for mm, _ in manual_extra if mm is m)
    how = collections.Counter(manual_level(mm, row)[1] for mm, row in manual_extra if mm is m)
    detail = ', '.join(f'{v} {k}' for k, v in how.items())
    replaced = m.get('sustituye_a') and m['sustituye_a'] not in manual_clubs
    print(f"Añadido a mano: {m['club']} en {LEAGUES.get(m['liga_ea'], ('', '', m['liga_ea']))[2]} ({n_ea} con datos de EA; nivel: {detail or '—'})" + (f"; {m['sustituye_a']} queda sin liga" if replaced else ''))
