/**
 * Constantes de calibración del motor de partido. Se ajustan con
 * `npm run calibrate` (5.000 partidos entre equipos de nivel igual).
 *
 * Probabilidad de cada acción:  p = 1 / (1 + exp(-((ataque - defensa) / k + sesgo)))
 * con ataque/defensa en escala de atributo (1-20). El sesgo fija la tasa de éxito
 * cuando ataque == defensa (p. ej. sesgo 1,9 → 87 %).
 */
export interface EngineConfig {
  /** Escala logística en puntos de atributo: 3 puntos de ventaja ≈ +1 en el exponente. */
  k: number;
  /** Fases de posesión por partido (±tempo y ruido). */
  phasesBase: number;
  /** Sesgos (éxito con igualdad) por acción. */
  bias: {
    shortPass: number;
    forwardPass: number;
    longPass: number;
    throughBall: number;
    dribble: number;
    cross: number;
    aerialDuel: number;
  };
  /** Pesos base de intención. */
  intent: {
    shoot: [number, number, number]; // franjas 5, 6, 7
    cross: number;
    dribble: number;
    forward: number;
    short: number;
    long: number;
    through: number;
  };
  /** xG base por situación. */
  xg: {
    band7Centre: number;
    band7Mid: number;
    band7Wide: number;
    band6Centre: number;
    band6Mid: number;
    band6Wide: number;
    band5: number;
    oneOnOne: number;
    header: number;
    cornerHeader: number;
    directFreeKick: number;
    penalty: number;
    counterBonus: number;
  };
  /** Ventaja de campo (multiplicador de atributos con estadio lleno grande). */
  homeAdvantage: number;
  /** Faltas, tarjetas y lesiones. */
  foulOnBeaten: number;
  foulOnTackle: number;
  /** Falta al disputar un pase (presión, agarrones). */
  foulOnPass: number;
  yellowPerFoul: number;
  redPerFoul: number;
  injuryPerDuel: number;
  /** Fatiga: pérdida de condición por fase para un jugador estándar. */
  drainPerPhase: number;
  /** Probabilidad base de que un pase al hueco fallado sea fuera de juego. */
  offsideOnThrough: number;
  /** Probabilidad de córner tras tiro bloqueado / parada / centro despejado. */
  cornerAfterBlock: number;
  cornerAfterSave: number;
  cornerAfterCross: number;
  /**
   * Aversión al empate 0-4: con empate a partir del 70', los equipos IA arriesgan más
   * (sube goles tardíos y baja el % de empates). Ver `npm run calibrate -- --draw 0.6`.
   */
  drawAversion: number;
  /**
   * Compacidad: densidad de defensores alrededor de la zona del balón. Un bloque bajo
   * (mentalidad defensiva, línea baja) concentra jugadores cerca del área: cuesta entrar,
   * los tiros son peores y se bloquean más, pero el rival tira más desde lejos y centra más.
   * Con 10 jugadores la densidad cae en todas partes.
   */
  compactness: {
    sigma: number;
    /** Densidad media de referencia (término neutro). */
    ref: number;
    /** Bonus defensivo por unidad de densidad por encima de la referencia. */
    weight: number;
    /** Reducción relativa del xG por unidad de densidad. */
    xg: number;
    /** Aumento de la probabilidad de bloqueo por unidad de densidad. */
    block: number;
    /** Más tiros lejanos y centros cuando el área está cerrada. */
    shootFromDistance: number;
  };
  /** Bonus defensivo por cada jugador de más (o de menos) en el campo. */
  numbersWeight: number;
  /** Partido tenso (final ajustado, partido importante): multiplica faltas y tarjetas de los jugadores de carácter caliente. */
  tension: { foul: number; card: number };
  /** Ritmo de partido: penalización de atributos, fatiga y riesgo de lesión con 0 de ritmo. */
  sharpness: { attr: number; drain: number; injury: number };
  /** Peso de la diferencia de velocidad/aceleración (piernas frescas) en regates y carreras al hueco. */
  paceDuel: number;
  /** Aumento de la probabilidad de contra por cada punto de mentalidad ofensiva del que pierde el balón. */
  counterExposure: number;
  /** Peso de la calidad del finalizador y del portero sobre el xG (exponente por punto de atributo). */
  shotQuality: { finisher: number; keeper: number };
  /**
   * Escala de los términos situacionales (presión, compacidad, superioridad numérica, contras,
   * piernas frescas), expresados en puntos de atributo y calibrados con k = 5,5: al subir k
   * para que el nivel de los jugadores pese menos, este factor mantiene el peso de las decisiones.
   */
  situationalWeight: number;
  /**
   * Gestión del partido: cuánto pesan las decisiones tomadas en el banquillo.
   * - exposurePerStep: peligro extra de las contras por cada punto de mentalidad ofensiva.
   * - push: facilidad para atacar en el último tercio por cada punto de mentalidad ofensiva (más gente arriba).
   * - block: dificultad para progresar ante un bloque defensivo, por cada punto de mentalidad defensiva.
   * - blockXg: peores ocasiones (menos xG y más tiros bloqueados) ante un bloque defensivo, por punto: el rival
   *   llega y tira, pero con peores ángulos y más gente delante.
   * - fatiguePhys / fatigueOther: pérdida máxima de atributos físicos / técnicos y mentales con la condición a 0.
   */
  management: { exposurePerStep: number; push: number; block: number; blockXg: number; fatiguePhys: number; fatigueOther: number };
  /**
   * Instrucciones que dependen del rival.
   * - lineVsPace: con la línea adelantada, ventaja de un delantero más rápido que su defensor al hueco (por punto
   *   de línea y punto de velocidad); con la línea baja, el espacio a la espalda se cierra.
   * - pressVsTech: la presión rinde más contra quien conduce con poca técnica (primer toque, técnica, compostura,
   *   pase) y menos contra el que la tiene (por punto de diferencia con 11).
   * - counterVsLine: peligro extra de las contras por cada punto de línea adelantada del que pierde el balón.
   * - tempoRisk: riesgo de pérdida con ritmo alto para pasadores flojos (por punto de ritmo y de pase bajo 12).
   */
  instructions: { lineVsPace: number; pressVsTech: number; counterVsLine: number; tempoRisk: number };
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  k: 8.5,
  phasesBase: 186,
  bias: {
    shortPass: 2.3,
    forwardPass: 1.0,
    longPass: 0.0,
    throughBall: -0.55,
    dribble: 0.15,
    cross: -0.45,
    aerialDuel: -0.2,
  },
  intent: {
    shoot: [0.103, 0.14, 0.372],
    cross: 0.55,
    dribble: 0.32,
    forward: 0.85,
    short: 2.4,
    long: 0.25,
    through: 0.14,
  },
  xg: {
    band7Centre: 0.185,
    band7Mid: 0.104,
    band7Wide: 0.045,
    band6Centre: 0.071,
    band6Mid: 0.049,
    band6Wide: 0.025,
    band5: 0.027,
    oneOnOne: 0.3,
    header: 0.098,
    cornerHeader: 0.06,
    directFreeKick: 0.06,
    penalty: 0.76,
    counterBonus: 1.2,
  },
  homeAdvantage: 0.068,
  foulOnBeaten: 0.36,
  foulOnTackle: 0.1,
  foulOnPass: 0.022,
  yellowPerFoul: 0.15,
  redPerFoul: 0.0025,
  injuryPerDuel: 0.0028,
  drainPerPhase: 0.15,
  offsideOnThrough: 0.4,
  cornerAfterBlock: 0.55,
  cornerAfterSave: 0.42,
  cornerAfterCross: 0.32,
  drawAversion: 0.3,
  compactness: { sigma: 0.19, ref: 2.1, weight: 0.9, xg: 0.12, block: 0.08, shootFromDistance: 1.0 },
  numbersWeight: 0.9,
  tension: { foul: 0.35, card: 0.35 },
  sharpness: { attr: 0.06, drain: 0.3, injury: 0.8 },
  paceDuel: 0.4,
  counterExposure: 0.07,
  shotQuality: { finisher: 0.03, keeper: 0.035 },
  situationalWeight: 1.55,
  management: { exposurePerStep: 0.08, push: 0.35, block: 0.2, blockXg: 0.07, fatiguePhys: 0.9, fatigueOther: 0.4 },
  instructions: { lineVsPace: 0.12, pressVsTech: 0.18, counterVsLine: 0.25, tempoRisk: 0.015 },
};

export function mergeConfig(partial?: Partial<EngineConfig>): EngineConfig {
  if (!partial) return DEFAULT_ENGINE_CONFIG;
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...partial,
    bias: { ...DEFAULT_ENGINE_CONFIG.bias, ...partial.bias },
    intent: { ...DEFAULT_ENGINE_CONFIG.intent, ...partial.intent },
    xg: { ...DEFAULT_ENGINE_CONFIG.xg, ...partial.xg },
    compactness: { ...DEFAULT_ENGINE_CONFIG.compactness, ...partial.compactness },
    tension: { ...DEFAULT_ENGINE_CONFIG.tension, ...partial.tension },
    sharpness: { ...DEFAULT_ENGINE_CONFIG.sharpness, ...partial.sharpness },
    shotQuality: { ...DEFAULT_ENGINE_CONFIG.shotQuality, ...partial.shotQuality },
    management: { ...DEFAULT_ENGINE_CONFIG.management, ...partial.management },
    instructions: { ...DEFAULT_ENGINE_CONFIG.instructions, ...partial.instructions },
  };
}

/** Probabilidad logística acotada a [0.01, 0.99]. */
export function logistic(attack: number, defence: number, k: number, bias = 0): number {
  const p = 1 / (1 + Math.exp(-((attack - defence) / k + bias)));
  return p < 0.01 ? 0.01 : p > 0.99 ? 0.99 : p;
}
