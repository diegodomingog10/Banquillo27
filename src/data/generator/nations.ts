/** Naciones ficticias del mundo generado (continente inventado: Aurelia). */
export interface NationSeed {
  id: string;
  name: string;
  code: string;
  style: string;
  reputation: number;
  leagueStrength: number;
  mandatoryReleaseClause: boolean;
  /** Nombres de las dos divisiones. */
  leagueNames: [string, string];
  cupName: string;
  /** Pausa invernal. */
  winterBreak: boolean;
}

export const CONTINENT = 'Aurelia';

export const NATION_SEEDS: readonly NationSeed[] = [
  { id: 'n_mrn', name: 'Merrenia', code: 'MRN', style: 'anglo', reputation: 9000, leagueStrength: 90, mandatoryReleaseClause: false,
    leagueNames: ['Premier de Merrenia', 'Championship de Merrenia'], cupName: 'Copa de la Corona de Merrenia', winterBreak: false },
  { id: 'n_alv', name: 'Altavera', code: 'ALV', style: 'iberico', reputation: 8800, leagueStrength: 88, mandatoryReleaseClause: true,
    leagueNames: ['Primera División de Altavera', 'Segunda División de Altavera'], cupName: 'Copa de Altavera', winterBreak: true },
  { id: 'n_brv', name: 'Brevonia', code: 'BRV', style: 'germanico', reputation: 8600, leagueStrength: 86, mandatoryReleaseClause: false,
    leagueNames: ['Liga Mayor de Brevonia', 'Segunda Liga de Brevonia'], cupName: 'Copa Federal de Brevonia', winterBreak: true },
  { id: 'n_ond', name: 'Ondaria', code: 'OND', style: 'italico', reputation: 8200, leagueStrength: 84, mandatoryReleaseClause: false,
    leagueNames: ['Serie Maggiore de Ondaria', 'Serie Cadetta de Ondaria'], cupName: 'Coppa di Ondaria', winterBreak: true },
  { id: 'n_vlm', name: 'Velmont', code: 'VLM', style: 'franco', reputation: 7800, leagueStrength: 80, mandatoryReleaseClause: false,
    leagueNames: ['Ligue Élite de Velmont', 'Ligue Deux de Velmont'], cupName: 'Coupe de Velmont', winterBreak: true },
  { id: 'n_trs', name: 'Tarsenia', code: 'TRS', style: 'lusofono', reputation: 6800, leagueStrength: 72, mandatoryReleaseClause: true,
    leagueNames: ['Liga Tarsenia', 'Liga Tarsenia 2'], cupName: 'Taça de Tarsenia', winterBreak: false },
  { id: 'n_kes', name: 'Kestria', code: 'KES', style: 'eslavo', reputation: 5800, leagueStrength: 64, mandatoryReleaseClause: false,
    leagueNames: ['Prva Liga de Kestria', 'Druga Liga de Kestria'], cupName: 'Kup de Kestria', winterBreak: true },
  { id: 'n_nrv', name: 'Norvania', code: 'NRV', style: 'nordico', reputation: 5000, leagueStrength: 58, mandatoryReleaseClause: false,
    leagueNames: ['Eliteserien de Norvania', 'Førstedivisjon de Norvania'], cupName: 'Copa de Norvania', winterBreak: true },
];
