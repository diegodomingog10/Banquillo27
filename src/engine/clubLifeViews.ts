/**
 * Vistas para la interfaz de la Fase 7: entrenamiento, centro médico, cantera, cuerpo
 * técnico, consejos de rotación y premios.
 */
import { mainPosition } from '../data/ability';
import type { Player } from '../data/schema';
import { t } from '../i18n';
import { ageAt } from './date';
import { indexes, type GameState } from './game';
import { recentChanges, seasonDelta } from './progression';
import { AREA_LABEL, coachQuality, FOCUS_LABEL, INDIVIDUAL_FOCUS, injuryRiskLevel, INTENSITY_LABEL, PRESETS, TRAINING_AREAS } from './training';

const nameOf = (p: Player) => p.commonName ?? `${p.firstName} ${p.lastName}`;
const stars = (v: number, ref: number) => Math.max(0.5, Math.min(5, Math.round((v / Math.max(1, ref)) * 10) / 2));

export function trainingView(state: GameState) {
  const ix = indexes(state);
  const club = ix.clubs.get(state.userClubId)!;
  const squad = ix.squads.get(club.id) ?? [];
  const best = Math.max(1, ...squad.map((p) => p.ca));
  const q = coachQuality(state, club.id);
  const staffIds = new Set(club.staffIds);
  const staff = state.world.staff.filter((s) => staffIds.has(s.id));
  const rows = squad.map((p) => {
    const ind = state.training.individual[p.id];
    const ch = recentChanges(state, p.id, 45);
    return {
      id: p.id, name: nameOf(p), position: mainPosition(p.positions), age: ageAt(p.birthDate, state.date),
      caStars: stars(p.ca, best), paStars: stars(p.pa, best), seasonDelta: seasonDelta(state, p),
      up: ch.filter((c) => c.delta > 0).length, down: ch.filter((c) => c.delta < 0).length,
      focus: ind?.focus ?? 'none', learning: ind?.position ?? null,
      learningLevel: ind?.position ? p.positions.find((x) => x.position === ind.position)?.rating ?? 0 : null,
      condition: Math.round(p.condition), sharpness: Math.round(p.matchSharpness), risk: injuryRiskLevel(state, p),
      injury: p.injury ? { type: t(`injury.${p.injury.type}`), days: p.injury.daysRemaining, total: p.injury.daysOut, severity: p.injury.severity } : null,
    };
  });
  return {
    plan: state.training.plan,
    presets: PRESETS.map((x) => ({ id: x.id, label: x.label, plan: x.plan })),
    areas: TRAINING_AREAS.map((a) => ({ id: a, label: AREA_LABEL[a], quality: Math.round(q[a] * 10) / 10 })),
    intensityLabel: INTENSITY_LABEL[state.training.plan.intensity],
    quality: { mental: q.mental, youth: q.youth, medical: q.medical },
    facilities: club.facilities,
    focusOptions: INDIVIDUAL_FOCUS.map((f) => ({ id: f, label: FOCUS_LABEL[f] })),
    rows,
    injuryLog: state.training.log.slice(0, 15).map((l) => ({ ...l, name: ix.players.get(l.playerId) ? nameOf(ix.players.get(l.playerId)!) : '' })),
    advice: rotationAdvice(state),
    staff: staff.map((s) => ({
      id: s.id, name: `${s.firstName} ${s.lastName}`, role: t(`staffRole.${s.role}`), roleId: s.role, age: ageAt(s.birthDate, state.date),
      key: keyAttrs(s.role).map((k) => ({ label: t(`staffAttr.${k}`), value: s.attributes[k] })),
    })),
    youth: squad.filter((p) => ageAt(p.birthDate, state.date) <= 19).sort((a, b) => b.pa - a.pa).map((p) => ({
      id: p.id, name: nameOf(p), position: mainPosition(p.positions), age: ageAt(p.birthDate, state.date),
      caStars: stars(p.ca, best), paStars: stars(p.pa, best), seasonDelta: seasonDelta(state, p),
      isNew: !!state.youthIntake?.ids.includes(p.id), personality: t(`personality.${p.personality}`),
    })),
    lastIntake: state.youthIntake,
  };
}

function keyAttrs(role: string): (keyof GameState['world']['staff'][number]['attributes'])[] {
  switch (role) {
    case 'manager': case 'assistantManager': return ['tactical', 'tacticalKnowledge', 'manManagement', 'motivating'];
    case 'coach': return ['attacking', 'defending', 'technical', 'tactical', 'fitness', 'mentalCoaching'];
    case 'goalkeepingCoach': return ['goalkeeping'];
    case 'fitnessCoach': return ['fitness', 'sportsScience'];
    case 'youthCoach': return ['workingWithYouth', 'technical'];
    case 'scout': case 'chiefScout': return ['judgingAbility', 'judgingPotential'];
    case 'physio': case 'doctor': return ['physiotherapy', 'sportsScience'];
    case 'analyst': return ['analysing', 'tacticalKnowledge'];
    default: return ['determination'];
  }
}

/** Consejos del cuerpo técnico sobre rotaciones y minutos. */
export function rotationAdvice(state: GameState): { playerId: string; name: string; kind: 'rest' | 'minutes' | 'risk'; text: string }[] {
  const ix = indexes(state);
  const squad = ix.squads.get(state.userClubId) ?? [];
  const out: { playerId: string; name: string; kind: 'rest' | 'minutes' | 'risk'; text: string }[] = [];
  for (const p of squad) {
    if (p.injury) continue;
    const share = state.dressing.happiness[p.id]?.share ?? 0.5;
    if (p.condition < 72 && share > 0.7) out.push({ playerId: p.id, name: nameOf(p), kind: 'rest', text: `Está al ${Math.round(p.condition)} % y lo juega casi todo: conviene darle descanso.` });
    else if (injuryRiskLevel(state, p) === 'high') out.push({ playerId: p.id, name: nameOf(p), kind: 'risk', text: 'Riesgo de lesión alto con la carga actual.' });
    else if (p.matchSharpness < 45 && ageAt(p.birthDate, state.date) >= 19 && p.ca >= (squad.map((x) => x.ca).sort((a, b) => b - a)[15] ?? 0)) out.push({ playerId: p.id, name: nameOf(p), kind: 'minutes', text: `Le falta ritmo de partido (${Math.round(p.matchSharpness)} %): necesita minutos.` });
  }
  return out.slice(0, 8);
}

export function awardsView(state: GameState) {
  const ix = indexes(state);
  const label = (id: string | null | undefined) => {
    const p = id ? ix.players.get(id) : undefined;
    return p ? { id: p.id, name: nameOf(p), club: p.clubId ? ix.clubs.get(p.clubId)?.name ?? '' : 'Libre', position: mainPosition(p.positions) } : null;
  };
  return state.awards.slice().reverse().map((a) => ({
    season: a.season, competition: ix.comps.get(a.competitionId)?.name ?? a.competitionId, competitionId: a.competitionId,
    playerOfSeason: label(a.playerOfSeason), topScorer: a.topScorer ? { ...label(a.topScorer.playerId), goals: a.topScorer.goals } : null,
    young: label(a.young), goalkeeper: label(a.goalkeeper), team: a.team.map((id) => label(id)).filter(Boolean),
  }));
}
