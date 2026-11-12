/**
 * Vistas de la Fase 4: perfil de jugador, plantilla completa, tácticas, análisis del
 * rival, buscador global y ficha de club. Todo serializable (se calcula en el Worker).
 */
import { mainPosition, POSITION_WEIGHTS } from '../data/ability';
import { ALL_ATTRS, VISIBLE_ATTRS, type AttrKey, type VisibleAttr } from '../data/attributes';
import { kitsOf } from '../data/kits';
import { GROUP_OF_POSITION, type Position, type PositionGroup } from '../data/positions';
import { bestRoleFor, ROLE_BY_ID, roleSuitability, rolesForPosition } from '../data/roles';
import type { Player } from '../data/schema';
import { t } from '../i18n';
import { ageAt } from './date';
import { clamp } from './rng';
import { indexes, leagueOf, leagueTable, type GameState } from './game';
import { isAvailable, positionRating, slotScore } from './lineup';
import { familiarityFor, resolveUserLineup } from './manager';
import { FORMATION_IDS } from './tactics';
import { fixtureView } from './views';
import { knowledgeOf, recommendation, scoutedAbility, scoutedAttributes } from './scouting';
import { askingPrice, playerInterest, ROLE_LABEL, windowOpen, dealView } from './transfers';
import { playerMood } from './dressingRoom';
import { recentChanges, seasonDelta } from './progression';

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;

/** Nivel en puntos (1-5, con medios) relativo al mejor de la plantilla, como las estrellas de FM. */
function stars(value: number, ref: number): number {
  return Math.max(0.5, Math.min(5, Math.round((value / Math.max(1, ref)) * 10) / 2));
}

// ---------------------------------------------------------------- radar
const RADAR_OUTFIELD: [string, AttrKey[]][] = [
  ['Ataque', ['finishing', 'offTheBall', 'composure']],
  ['Creatividad', ['vision', 'flair', 'passing']],
  ['Técnica', ['technique', 'firstTouch', 'dribbling']],
  ['Velocidad', ['pace', 'acceleration']],
  ['Físico', ['strength', 'stamina', 'balance', 'naturalFitness']],
  ['Aéreo', ['heading', 'jumping']],
  ['Defensa', ['tackling', 'marking', 'positioning']],
  ['Mental', ['decisions', 'concentration', 'determination', 'teamwork', 'workRate', 'anticipation']],
];
const RADAR_GK: [string, AttrKey[]][] = [
  ['Reflejos', ['reflexes']],
  ['Uno contra uno', ['oneOnOnes']],
  ['Juego aéreo', ['aerialReach', 'jumping']],
  ['Manejo', ['handling']],
  ['Distribución', ['kicking', 'playWithFeet']],
  ['Mando', ['communication', 'positioning']],
  ['Agilidad', ['agility', 'balance']],
  ['Mental', ['concentration', 'decisions', 'composure']],
];

function radarFor(p: Player) {
  const axes = mainPosition(p.positions) === 'GK' ? RADAR_GK : RADAR_OUTFIELD;
  return axes.map(([label, attrs]) => ({ label, value: Math.round((attrs.reduce((a, k) => a + p.attributes[k], 0) / attrs.length) * 10) / 10 }));
}

/** Media del radar de los jugadores del mismo grupo posicional en la misma liga. */
function leagueAverageRadar(state: GameState, p: Player) {
  const ix = indexes(state);
  const group = GROUP_OF_POSITION[mainPosition(p.positions)];
  const league = p.clubId ? leagueOf(state, p.clubId) : undefined;
  const clubIds = new Set(league?.teamIds ?? []);
  const peers = state.world.players.filter((x) => x.clubId && clubIds.has(x.clubId) && GROUP_OF_POSITION[mainPosition(x.positions)] === group);
  const list = peers.length ? peers : ix.squads.get(p.clubId ?? '') ?? [p];
  const axes = group === 'GK' ? RADAR_GK : RADAR_OUTFIELD;
  return {
    label: league ? `Media de ${t(`posGroup.${group}`)} en ${league.name}` : 'Media de su posición',
    values: axes.map(([label, attrs]) => ({
      label,
      value: Math.round((list.reduce((a, x) => a + attrs.reduce((b, k) => b + x.attributes[k], 0) / attrs.length, 0) / list.length) * 10) / 10,
    })),
  };
}

/** Informe del cuerpo técnico: puntos fuertes y débiles según la posición. */
function staffReport(p: Player) {
  const main = mainPosition(p.positions);
  const group = GROUP_OF_POSITION[main];
  const weights = POSITION_WEIGHTS[group];
  const important = (Object.entries(weights) as [VisibleAttr, number][]).filter(([, w]) => w >= 2).map(([a]) => a);
  const sorted = important.slice().sort((a, b) => p.attributes[b] - p.attributes[a]);
  const strengths = sorted.slice(0, 3);
  const weaknesses = sorted.slice(-2).filter((a) => p.attributes[a] <= 12);
  const best = bestRoleFor(p.attributes, main);
  const label = (a: AttrKey) => t(`attr.${a}`).toLowerCase();
  const text = `${nameOf(p)} destaca en ${strengths.map(label).join(', ')}.` +
    (weaknesses.length ? ` Debería mejorar ${weaknesses.map(label).join(' y ')}.` : ' No tiene carencias claras para su posición.') +
    (best ? ` Su mejor rol es ${t(`role.${best.role.id}`).toLowerCase()}.` : '');
  return { text, strengths: strengths.map((a) => t(`attr.${a}`)), weaknesses: weaknesses.map((a) => t(`attr.${a}`)), bestRole: best ? t(`role.${best.role.id}`) : null };
}

// ---------------------------------------------------------------- perfil
export function playerProfile(state: GameState, playerId: string) {
  const ix = indexes(state);
  const p = ix.players.get(playerId);
  if (!p) return null;
  const club = p.clubId ? ix.clubs.get(p.clubId) : undefined;
  const squad = p.clubId ? ix.squads.get(p.clubId) ?? [] : [p];
  const best = Math.max(...squad.map((x) => x.ca), p.ca);
  const seasons = [...p.careerStats, ...p.seasonStats];
  const bySeason = new Map<string, { season: string; club: string; apps: number; goals: number; assists: number; rating: number }>();
  for (const s of seasons) {
    const key = `${s.season}|${s.clubId}`;
    const r = bySeason.get(key) ?? { season: s.season, club: s.clubId ? ix.clubs.get(s.clubId)?.name ?? s.clubId : '—', apps: 0, goals: 0, assists: 0, rating: 0 };
    r.rating = (r.rating * r.apps + s.avgRating * s.apps) / Math.max(1, r.apps + s.apps);
    r.apps += s.apps;
    r.goals += s.goals;
    r.assists += s.assists;
    bySeason.set(key, r);
  }
  const current = p.seasonStats.reduce((a, s) => ({ apps: a.apps + s.apps, goals: a.goals + s.goals, rating: a.rating + s.avgRating * s.apps }), { apps: 0, goals: 0, rating: 0 });
  const injuryRisk = p.attributes.injuryProneness * (1.6 - p.condition / 100);
  const isUser = p.clubId === state.userClubId;
  const scouted = scoutedAttributes(state, p);
  const userBest = Math.max(1, ...(ix.squads.get(state.userClubId) ?? []).map((x) => x.ca));
  const ability = isUser ? null : scoutedAbility(state, p, userBest);
  const tr = state.transfers;
  const deal = tr.deals.find((d) => d.playerId === p.id && (d.buyerId === state.userClubId || d.sellerId === state.userClubId) && ['pendingClub', 'countered', 'negotiating', 'agreed', 'pendingUser'].includes(d.status));
  const loan = tr.loans.find((l) => l.playerId === p.id);
  const known = scouted.level >= 40;
  return {
    id: p.id,
    name: nameOf(p),
    firstName: p.firstName,
    lastName: p.lastName,
    initials: `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase(),
    age: ageAt(p.birthDate, state.date),
    birthDate: p.birthDate,
    nationalities: p.nationalities.map((n) => state.world.nations.find((x) => x.id === n)?.name ?? n),
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    foot: p.preferredFoot,
    club: club ? { id: club.id, name: club.name } : null,
    isUser,
    knowledge: scouted.level,
    attrError: scouted.error,
    personalityKnown: isUser || scouted.personalityKnown,
    caRange: ability?.ca ?? null,
    paRange: ability?.pa ?? null,
    market: isUser ? {
      kind: 'own' as const,
      listed: tr.listed[p.id] ?? null,
      role: tr.roles[p.id] ? ROLE_LABEL[tr.roles[p.id]!] : null,
      loanedIn: loan && loan.borrowerId === state.userClubId ? { owner: ix.clubs.get(loan.ownerId)?.name ?? '', buyOption: loan.buyOption, until: loan.until } : null,
    } : {
      kind: 'other' as const,
      asking: p.clubId && known ? askingPrice(state, p, state.userClubId) : null,
      interest: playerInterest(state, p, state.userClubId),
      recommendation: known ? recommendation(state, p) : null,
      free: !p.clubId,
      windowOpen: windowOpen(state),
    },
    deal: deal ? dealView(state, deal) : null,
    reportPending: state.scouting.requests.some((r) => r.playerId === p.id),
    mood: isUser ? playerMood(state, p) : null,
    changes: isUser ? Object.fromEntries(recentChanges(state, p.id, 60).map((c) => [c.attr, c.delta])) as Record<string, number> : {},
    seasonDelta: isUser ? seasonDelta(state, p) : null,
    shortlisted: state.ui.shortlist.includes(p.id),
    positions: p.positions.map((x) => ({ position: x.position, rating: x.rating })).sort((a, b) => b.rating - a.rating),
    mainPosition: mainPosition(p.positions),
    personality: isUser || scouted.personalityKnown ? t(`personality.${p.personality}`) : 'Personalidad desconocida',
    caStars: ability ? (ability.ca[0] + ability.ca[1]) / 2 : stars(p.ca, best),
    paStars: ability ? (ability.pa[0] + ability.pa[1]) / 2 : stars(p.pa, best),
    value: p.marketValue,
    wage: p.contract?.wage ?? null,
    contractExpires: p.contract?.expires ?? null,
    releaseClause: p.contract?.releaseClause ?? null,
    loan: p.contract?.type === 'loan',
    avgRating: current.apps ? Math.round((current.rating / current.apps) * 100) / 100 : null,
    apps: current.apps,
    goals: current.goals,
    attributes: Object.fromEntries(ALL_ATTRS.map((a) => [a, isUser ? p.attributes[a] : scouted.attributes[a].value])) as Record<AttrKey, number | null>,
    estimated: p.estimated.filter((e) => e.startsWith('attributes.')).map((e) => e.slice(11)),
    radar: isUser || scouted.level >= 50 ? radarFor(p) : null,
    radarAverage: leagueAverageRadar(state, p),
    status: {
      condition: Math.round(p.condition),
      sharpness: Math.round(p.matchSharpness),
      morale: Math.round(p.morale),
      injuryRisk: injuryRisk < 9 ? 'low' : injuryRisk < 14 ? 'medium' : 'high',
      injury: p.injury ? { type: t(`injury.${p.injury.type}`), days: p.injury.daysRemaining } : null,
      suspended: p.cards.suspendedMatches,
      yellow: p.cards.yellow,
    },
    report: isUser || known ? staffReport(p) : { text: 'Sabemos poco de este jugador. Pide un informe a los ojeadores.', bestRole: null, strengths: [], weaknesses: [] } as unknown as ReturnType<typeof staffReport>,
    history: [...bySeason.values()].map((r) => ({ ...r, rating: Math.round(r.rating * 100) / 100 })).reverse(),
    form: p.form,
  };
}
export type PlayerProfile = NonNullable<ReturnType<typeof playerProfile>>;

// ---------------------------------------------------------------- plantilla
export function squadTable(state: GameState, clubId = state.userClubId) {
  const ix = indexes(state);
  const squad = ix.squads.get(clubId) ?? [];
  const best = Math.max(1, ...squad.map((p) => p.ca));
  const lineup = clubId === state.userClubId ? new Set(resolveUserLineup(state).starting) : new Set<string>();
  return squad.map((p) => {
    const ss = p.seasonStats.filter((s) => s.season === state.season);
    const apps = ss.reduce((a, s) => a + s.apps, 0);
    const rating = apps ? ss.reduce((a, s) => a + s.avgRating * s.apps, 0) / apps : 0;
    const main = mainPosition(p.positions);
    return {
      id: p.id,
      name: nameOf(p),
      position: main,
      group: GROUP_OF_POSITION[main] as PositionGroup,
      positions: p.positions.filter((x) => x.rating >= 15).map((x) => x.position),
      age: ageAt(p.birthDate, state.date),
      nationality: state.world.nations.find((n) => n.id === p.nationalities[0])?.code ?? '',
      caStars: stars(p.ca, best),
      paStars: stars(p.pa, best),
      ca: p.ca,
      condition: Math.round(p.condition),
      sharpness: Math.round(p.matchSharpness),
      morale: Math.round(p.morale),
      value: p.marketValue,
      wage: p.contract?.wage ?? 0,
      contractExpires: p.contract?.expires ?? null,
      apps,
      starts: ss.reduce((a, s) => a + s.starts, 0),
      minutes: ss.reduce((a, s) => a + s.minutes, 0),
      goals: ss.reduce((a, s) => a + s.goals, 0),
      assists: ss.reduce((a, s) => a + s.assists, 0),
      yellow: ss.reduce((a, s) => a + s.yellow, 0),
      red: ss.reduce((a, s) => a + s.red, 0),
      rating: Math.round(rating * 100) / 100,
      injury: p.injury ? { type: t(`injury.${p.injury.type}`), days: p.injury.daysRemaining } : null,
      suspended: p.cards.suspendedMatches,
      inLineup: lineup.has(p.id),
      shortlisted: state.ui.shortlist.includes(p.id),
      attributes: Object.fromEntries(VISIBLE_ATTRS.map((a) => [a, p.attributes[a]])) as Record<VisibleAttr, number>,
      personality: t(`personality.${p.personality}`),
    };
  });
}
export type SquadTableRow = ReturnType<typeof squadTable>[number];

// ---------------------------------------------------------------- tácticas
export function tacticsView(state: GameState) {
  const ix = indexes(state);
  const squad = ix.squads.get(state.userClubId) ?? [];
  const lineup = resolveUserLineup(state);
  const tactic = state.userTactic;
  // Idoneidad relativa (0-5 en medios puntos): las notas absolutas (1-20) de una plantilla se parecen mucho entre
  // sí, así que se comparan con una referencia para que se vean las diferencias.
  //  · fit: frente al mejor de la plantilla para ese hueco (5 = el mejor; −0,7 por punto de diferencia).
  //  · roleFit / roleStars: frente al mejor rol del jugador en ese puesto (5 = su rol ideal; −1,6 por punto).
  const half = (v: number) => Math.round(clamp(v, 0.5, 5) * 2) / 2;
  const slotScores = squad.map((p) => tactic.slots.map((slot) => slotScore(p, slot)));
  const bestBySlot = tactic.slots.map((_, i) => Math.max(...slotScores.map((row) => row[i] ?? 0)));
  const roleStarsOf = (p: Player, pos: Position) => {
    const scores = rolesForPosition(pos).map((r) => [r.id, roleSuitability(p.attributes, r)] as const);
    const best = Math.max(...scores.map(([, s]) => s));
    return Object.fromEntries(scores.map(([id, s]) => [id, { stars: half(5 - (best - s) * 1.6), score: Math.round(s * 10) / 10 }]));
  };
  const players = squad.map((p, pi) => ({
    id: p.id,
    name: nameOf(p),
    shortName: p.commonName ?? p.lastName,
    position: mainPosition(p.positions),
    condition: Math.round(p.condition),
    available: isAvailable(p),
    injury: p.injury ? p.injury.daysRemaining : null,
    suspended: p.cards.suspendedMatches,
    /** Idoneidad 0-5 para cada hueco, comparada con el mejor de la plantilla para ese hueco. */
    fit: tactic.slots.map((_, i) => half(5 - ((bestBySlot[i] ?? 0) - (slotScores[pi]?.[i] ?? 0)) * 0.7)),
    /** Nota absoluta (1-20) para cada hueco: idoneidad al rol × dominio de la posición × forma física. */
    fitScore: tactic.slots.map((_, i) => Math.round((slotScores[pi]?.[i] ?? 0) * 10) / 10),
    /** Encaje 0-5 del rol de cada hueco, comparado con el mejor rol del jugador en ese puesto. */
    roleFit: tactic.slots.map((slot) => roleStarsOf(p, slot.position)[slot.role]?.stars ?? 0),
    /** Encaje de cada rol posible en cada hueco: { estrellas 0-5, nota 1-20 }. */
    roleStars: tactic.slots.map((slot) => roleStarsOf(p, slot.position)),
    positionRating: tactic.slots.map((slot) => positionRating(p, slot.position)),
  }));
  return {
    tactic,
    lineup,
    familiarity: Math.round(state.tacticFamiliarity),
    /** Familiaridad con cada formación (la actual, las ya trabajadas y la de empezar de cero en las demás). */
    formationFamiliarity: Object.fromEntries(FORMATION_IDS.map((f) => [f, Math.round(familiarityFor(state, f))])),
    players,
    roles: Object.fromEntries(
      (['GK', 'LB', 'CB', 'RB', 'LWB', 'RWB', 'DM', 'LM', 'CM', 'RM', 'LW', 'AM', 'RW', 'ST'] as Position[]).map((pos) => [
        pos,
        rolesForPosition(pos).map((r) => ({ id: r.id, label: t(`role.${r.id}`), duties: r.duties })),
      ]),
    ) as Record<Position, { id: string; label: string; duties: readonly string[] }[]>,
  };
}
export type TacticsView = ReturnType<typeof tacticsView>;

// ---------------------------------------------------------------- análisis del rival
export function opponentAnalysis(state: GameState, clubId: string) {
  const ix = indexes(state);
  const club = ix.clubs.get(clubId);
  if (!club) return null;
  const squad = (ix.squads.get(clubId) ?? []).slice().sort((a, b) => b.ca - a.ca);
  const played = state.fixtures.filter((f) => f.played && (f.homeId === clubId || f.awayId === clubId));
  let gf = 0;
  let ga = 0;
  let scoredHome = 0;
  let homeGames = 0;
  for (const f of played) {
    const home = f.homeId === clubId;
    gf += home ? f.result!.homeGoals : f.result!.awayGoals;
    ga += home ? f.result!.awayGoals : f.result!.homeGoals;
    if (home) { homeGames++; scoredHome += f.result!.homeGoals; }
  }
  const manager = state.world.staff.find((s) => s.clubId === clubId && s.role === 'manager');
  const avg = (attrs: AttrKey[]) => {
    const top = squad.slice(0, 14);
    return top.reduce((a, p) => a + attrs.reduce((b, k) => b + p.attributes[k], 0) / attrs.length, 0) / Math.max(1, top.length);
  };
  const traits: [string, number][] = [
    ['juego aéreo', avg(['heading', 'jumping'])],
    ['velocidad', avg(['pace', 'acceleration'])],
    ['creatividad', avg(['vision', 'passing', 'flair'])],
    ['solidez defensiva', avg(['tackling', 'marking', 'positioning'])],
    ['físico', avg(['strength', 'stamina'])],
    ['definición', avg(['finishing', 'composure'])],
  ];
  traits.sort((a, b) => b[1] - a[1]);
  const league = leagueOf(state, clubId);
  const row = league ? leagueTable(state, league.id).find((r) => r.clubId === clubId && r.played > 0) : undefined;
  return {
    club: { id: club.id, name: club.name, reputation: club.reputation },
    formation: manager?.preferredFormation ?? '4-4-2',
    position: row?.position ?? null,
    played: played.length,
    goalsFor: played.length ? Math.round((gf / played.length) * 100) / 100 : 0,
    goalsAgainst: played.length ? Math.round((ga / played.length) * 100) / 100 : 0,
    homeGoals: homeGames ? Math.round((scoredHome / homeGames) * 100) / 100 : 0,
    strengths: traits.slice(0, 2).map((x) => x[0]),
    weaknesses: traits.slice(-2).map((x) => x[0]),
    keyPlayers: squad.filter(isAvailable).slice(0, 4).map((p) => ({ id: p.id, name: nameOf(p), position: mainPosition(p.positions), stars: stars(p.ca, squad[0]?.ca ?? p.ca) })),
    recent: played.sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 5).map((f) => fixtureView(state, f, clubId)),
  };
}

// ---------------------------------------------------------------- buscador
const SCREENS: { id: string; label: string; keywords: string }[] = [
  { id: 'dashboard', label: 'Inicio', keywords: 'inicio panel portada' },
  { id: 'inbox', label: 'Bandeja de entrada', keywords: 'bandeja mensajes correo' },
  { id: 'squad', label: 'Plantilla', keywords: 'plantilla jugadores equipo' },
  { id: 'tactics', label: 'Tácticas', keywords: 'tacticas alineacion formacion' },
  { id: 'competitions', label: 'Competiciones', keywords: 'competiciones clasificacion liga copa calendario' },
  { id: 'club', label: 'Club', keywords: 'club estadio instalaciones equipaciones' },
  { id: 'transfers', label: 'Fichajes', keywords: 'fichajes mercado traspasos ojeadores scouting cesiones' },
  { id: 'finances', label: 'Finanzas', keywords: 'finanzas dinero presupuesto salarios ingresos gastos' },
  { id: 'training', label: 'Entrenamiento', keywords: 'entrenamiento plan carga lesiones medico cantera juveniles staff tecnico' },
  { id: 'dressing', label: 'Vestuario', keywords: 'vestuario moral promesas reunion lideres grupos' },
  { id: 'datahub', label: 'Data Hub', keywords: 'data hub estadisticas xg goleadores lideres percentiles' },
  { id: 'world', label: 'Mundo', keywords: 'mundo rankings ligas entrenadores selecciones carrera palmares' },
  { id: 'board', label: 'Directiva', keywords: 'directiva confianza objetivos peticiones' },
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function search(state: GameState, query: string) {
  const q = fold(query.trim());
  if (q.length < 2) return { screens: SCREENS.slice(0, 6).map(({ id, label }) => ({ id, label })), players: [], clubs: [] };
  const ix = indexes(state);
  const players: { id: string; name: string; detail: string }[] = [];
  for (const p of state.world.players) {
    if (players.length >= 12) break;
    const n = fold(`${p.firstName} ${p.lastName} ${p.commonName ?? ''}`);
    if (n.includes(q)) {
      players.push({ id: p.id, name: nameOf(p), detail: `${t(`pos.${mainPosition(p.positions)}`)} · ${ageAt(p.birthDate, state.date)} años · ${p.clubId ? ix.clubs.get(p.clubId)?.name ?? '' : 'Libre'}` });
    }
  }
  const clubs = state.world.clubs
    .filter((c) => fold(`${c.name} ${c.city}`).includes(q))
    .slice(0, 8)
    .map((c) => ({ id: c.id, name: c.name, detail: leagueOf(state, c.id)?.name ?? '' }));
  const screens = SCREENS.filter((s) => fold(`${s.label} ${s.keywords}`).includes(q)).map(({ id, label }) => ({ id, label }));
  return { screens, players, clubs };
}

// ---------------------------------------------------------------- club
export function clubView(state: GameState, clubId: string) {
  const ix = indexes(state);
  const club = ix.clubs.get(clubId);
  if (!club) return null;
  const league = leagueOf(state, clubId);
  const nation = state.world.nations.find((n) => n.id === club.nationId);
  const titles = state.history.filter((h) => h.championId === clubId).map((h) => ({ season: h.season, competition: ix.comps.get(h.competitionId)?.name ?? h.competitionId }));
  return {
    id: club.id,
    name: club.name,
    city: club.city,
    nation: nation?.name ?? '',
    founded: club.founded,
    reputation: club.reputation,
    colors: club.colors,
    kits: kitsOf(club),
    league: league ? { id: league.id, name: league.name } : null,
    position: (() => { const r = league ? leagueTable(state, league.id).find((x) => x.clubId === clubId) : undefined; return r && r.played > 0 ? r.position : null; })(),
    stadium: club.stadium,
    futureStadium: club.futureStadium ?? null,
    facilities: club.facilities,
    finances: club.finances,
    objectives: club.boardObjectives.map((o) => t(`objective.${o.type}`, { target: o.target ?? '' })),
    rivals: club.rivals.map((r) => ({ id: r, name: ix.clubs.get(r)?.name ?? r })),
    titles,
    isUser: clubId === state.userClubId,
    squad: squadTable(state, clubId).sort((a, b) => b.ca - a.ca).map((r) => ({ id: r.id, name: r.name, position: r.position, age: r.age, caStars: r.caStars, value: r.value })),
  };
}
