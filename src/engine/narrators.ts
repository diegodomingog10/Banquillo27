/**
 * Narradores del partido en directo. Cada partido lo narra uno al azar (según la semilla
 * del partido). Frases de homenaje a su estilo, escritas para el juego; el narrador
 * "neutro" se usa en informes y como respaldo.
 *
 * Marcadores: {p} jugador, {o} otro jugador, {t} equipo, {how} tipo de remate,
 * {s} marcador tras la jugada, {r} equipo rival.
 */
export const NARRATOR_IDS = ['montes', 'rivero', 'roman'] as const;
export type NarratorId = (typeof NARRATOR_IDS)[number];

export const NARRATOR_NAMES: Record<NarratorId, string> = {
  montes: 'Andrés Montes',
  rivero: 'Juan Carlos Rivero',
  roman: 'Miguel Ángel Román',
};

export type Moment =
  | 'kickOff' | 'halfTime' | 'fullTime' | 'addedTime' | 'extraTime' | 'shootout'
  | 'goal' | 'goalLate' | 'goalEqualizer' | 'goalAhead' | 'goalRout' | 'goalShootout'
  | 'save' | 'woodwork' | 'blocked' | 'bigMiss' | 'penalty' | 'penaltyMissed'
  | 'yellow' | 'secondYellow' | 'red' | 'sub' | 'subInjury' | 'injury'
  | 'offside' | 'corner' | 'freeKick' | 'foul' | 'mentality' | 'formation';

type Bank = Partial<Record<Moment, string[]>>;

export const NEUTRAL: Record<Moment, string[]> = {
  kickOff: ['¡Arranca el partido!'],
  halfTime: ['Final de la primera parte.'],
  fullTime: ['Final del partido.'],
  addedTime: ['Se añaden {n} minutos.'],
  extraTime: ['Empate: vamos a la prórroga.'],
  shootout: ['Todo se decide en la tanda de penaltis.'],
  goal: ['¡GOOOL de {p}! Remata {how} y bate al portero.', '¡Gol de {t}! {p} no perdona {how}.', '¡{p} la mete {how}! Golazo para {t}.'],
  goalLate: [], goalEqualizer: [], goalAhead: [], goalRout: [],
  goalShootout: ['{p} marca su penalti.', 'Gol de {p} en la tanda.'],
  save: ['¡Paradón de {p}! Saca el disparo de {o} {how}.', '{o} lo intenta {how}, pero {p} responde bien.', 'Tiro de {o} {how}; atrapa {p}.'],
  woodwork: ['¡Al palo! {p} acaricia el gol.', '¡El larguero salva al rival! Disparo de {p}.'],
  blocked: ['Disparo de {p}, bloqueado por la defensa.', '{p} chuta, pero el balón choca en un defensor.'],
  bigMiss: ['¡Qué ocasión! {p} la manda fuera {how}.', '¡Se le escapa a {p}! Clarísima {how}.'],
  penalty: ['¡Penalti a favor de {t}! Falta sobre {p}.'],
  penaltyMissed: ['¡{p} falla el penalti!'],
  yellow: ['Amarilla para {p}.', 'El árbitro amonesta a {p}.'],
  secondYellow: ['¡Segunda amarilla para {p}! {t} se queda con uno menos.'],
  red: ['¡Roja directa a {p}! {t} se queda con diez.'],
  sub: ['Cambio en {t}: entra {p}, se retira {o}.'],
  subInjury: ['Cambio obligado en {t}: entra {p} por el lesionado {o}.'],
  injury: ['Se duele {p}… parece que no puede seguir.'],
  offside: ['Fuera de juego de {p}.'],
  corner: ['Córner para {t}.'],
  freeKick: ['Falta peligrosa para {t}; se prepara {p}.'],
  foul: ['Falta de {p} sobre {o}.'],
  mentality: ['{t} cambia su planteamiento.'],
  formation: ['{t} cambia de sistema: {f}.'],
};

/** Showman: jazz, motes, espectáculo. */
const MONTES: Bank = {
  kickOff: ['¡Buenas noches, amigos! Se apagan las luces, suena la banda y empieza el espectáculo.', 'Arranca el baile. Que suene el jazz, que esto va a tener swing.', '¡Rueda la pelota! La vida puede ser maravillosa, y hoy toca fútbol.'],
  halfTime: ['Descanso. Bocadillo de calamares y a la vuelta, más jazz.', 'Se acaba el primer acto. Pasen por taquilla, que el segundo promete.', 'Media parte. Los artistas al camerino a afinar los instrumentos.'],
  fullTime: ['¡Se acabó! Se baja el telón; los músicos guardan los instrumentos. {s}.', 'Final. Apaguen las luces, que esto ha sido un concierto. {s}.', 'Pitido final. Hasta aquí la función de hoy, amigos. {s}.'],
  addedTime: ['{n} minutos de propina. ¡Esto no se acaba hasta que canta la señora gorda!', 'Añade {n} el colegiado. Tiempo para un último solo de saxo.'],
  extraTime: ['¡Prórroga! Pidan otro café, que esto tiene bis.'],
  shootout: ['¡Penaltis! La lotería, la ruleta, el corazón en un puño.'],
  goal: ['¡Jugón, jugón, jugón! ¡{p}, {how}! ¡Qué maravilla! {s}.', '¡Ahí está, ahí está! ¡{p} pone la nota de jazz {how}! {s}.', '¡Gooool de {t}! ¡{p}, el hombre del frac, {how}! {s}.', '¡Tiki-taka, tiki-taka… y gol! {p} lo culmina {how}. {s}.'],
  goalLate: ['¡Al final, al final! ¡{p}, con el reloj casi parado! ¡Esto es jazz del bueno! {s}.', '¡Agónico! ¡{p} en el último suspiro! ¡Que alguien llame a un cardiólogo! {s}.'],
  goalEqualizer: ['¡Empate! ¡{p} devuelve la música a {t}! {s}.', '¡{p} iguala {how}! Aquí no se rinde ni el apuntador. {s}.'],
  goalAhead: ['¡{p} pone por delante a {t}! ¡Qué ritmo, qué cadencia! {s}.', '¡{p}! ¡{t} manda en la pista de baile! {s}.'],
  goalRout: ['¡Otro más! {p} sigue la fiesta. {r}, ¿dónde están las llaves? {s}.', '¡Esto ya es un recital! {p} {how}. Matarile, rile, rile. {s}.'],
  goalShootout: ['{p}, frío como un témpano. Dentro.', '¡Adentro! {p} no tiembla.'],
  save: ['¡Paradón de {p}! ¡Manos de pianista! Le quita el gol a {o}.', '{o} lo intenta {how}… y aparece {p}, el hombre de goma.', '¡Uy, uy, uy! {p} vuela y saca el disparo de {o}.'],
  woodwork: ['¡Al palo! ¡La madera dice que no! {p} se lleva las manos a la cabeza.', '¡Larguero! {p} toca el cielo, pero el cielo es de metal.'],
  blocked: ['{p} prueba, pero ahí hay un muro de hormigón armado.', 'Lo intenta {p}; la defensa no deja pasar ni el aire.'],
  bigMiss: ['¡Nooo! ¡{p}, eso no se puede fallar {how}! Ay, la vida…', '¡Qué ocasión! {p} desafina en el momento cumbre.'],
  penalty: ['¡Penalti! ¡Derriban a {p}! Silencio en la sala.'],
  penaltyMissed: ['¡Lo falla {p}! El portero adivina la partitura.'],
  yellow: ['Amarilla para {p}. El hombre de negro saca la cartulina.', 'Tarjeta a {p}. Ojo, que esto no es lucha libre.'],
  secondYellow: ['¡A la calle! Segunda amarilla a {p}. Ducha temprana. {t}, con diez.'],
  red: ['¡Roja directa a {p}! Se acabó la función para él. {t}, con diez.'],
  sub: ['Cambio en {t}: sale {o}, entra {p} a ponerle salsa.', 'Entra {p} por {o}. Sangre fresca para la orquesta de {t}.'],
  subInjury: ['Cambio obligado: {o} se retira tocado, entra {p}.'],
  injury: ['Se duele {p}… mala pinta. Que salgan las asistencias.'],
  offside: ['Fuera de juego de {p}. Se adelantó al compás.'],
  corner: ['Córner para {t}. Se arma el baile en el área.'],
  freeKick: ['Falta peligrosa. {p} acaricia el balón como un violinista.'],
  foul: ['Falta de {p} sobre {o}. Esto no es danza clásica.'],
  mentality: ['{t} cambia la partitura desde el banquillo.'],
  formation: ['{t} cambia de sistema: {f}. Nuevo arreglo para la banda.'],
};

/** Emocional: épica, gritos largos, intensidad. */
const RIVERO: Bank = {
  kickOff: ['¡Rueda el balón! ¡Comienza el partido!', '¡Ya está aquí! ¡Pita el árbitro y arranca el encuentro!'],
  halfTime: ['¡Descanso! Primera parte vibrante, nos vamos al intermedio. {s}.', 'Se acaba la primera mitad. {s}. ¡Queda todo por decidir!'],
  fullTime: ['¡Final! ¡Se acabó el partido! {s}.', '¡Termina! ¡Pita el final el colegiado! {s}.'],
  addedTime: ['¡{n} minutos de añadido! ¡Todavía queda partido!'],
  extraTime: ['¡Prórroga! ¡Treinta minutos más de emoción!'],
  shootout: ['¡Penaltis! ¡La tanda decidirá quién sigue vivo!'],
  goal: ['¡Goooooooool! ¡Goooool de {t}! ¡{p}, {how}! ¡Qué barbaridad! {s}.', '¡Gol, gol, gol! ¡{p}! ¡Lo hizo {how}! {s}.', '¡Dentro, dentro, dentro! ¡Goooool de {p}! {s}.'],
  goalLate: ['¡Goooooool! ¡En el último minuto! ¡{p}! ¡No se lo pueden creer! ¡Es increíble! {s}.', '¡Golazo de {p} cuando se moría el partido! ¡Locura total! {s}.'],
  goalEqualizer: ['¡Goooool! ¡El empate! ¡{p} iguala para {t}! ¡Partido nuevo! {s}.', '¡Lo empata {p}! ¡{t} está viva! {s}.'],
  goalAhead: ['¡Goooool! ¡{p} adelanta a {t}! ¡Qué momento! {s}.', '¡Gol de {p}! ¡{t} se pone por delante! {s}.'],
  goalRout: ['¡Otro gol más! ¡{p}! ¡Esto es un vendaval! {s}.', '¡Y van…! ¡{p} hace otro! ¡Exhibición de {t}! {s}.'],
  goalShootout: ['¡Gol! ¡{p} no falla!', '¡Dentro! ¡{p} con todo el temple!'],
  save: ['¡Paradón! ¡Qué parada de {p}! ¡Se lo quita a {o}!', '¡Uyyy! ¡{p} salva a su equipo! Disparo de {o} {how}.', '¡Lo saca {p}! ¡Milagro bajo palos!'],
  woodwork: ['¡Al palooo! ¡{p} estrella el balón en la madera!', '¡Larguero! ¡Por centímetros! ¡{p} se queda sin el gol!'],
  blocked: ['¡Disparo de {p}! ¡Bloqueado!', '¡Lo intenta {p}! ¡Se cruza la defensa!'],
  bigMiss: ['¡Noooo! ¡La tenía {p}! ¡Increíble, se marcha fuera!', '¡Qué ocasión! ¡{p} solo, {how}… y fuera!'],
  penalty: ['¡Penalti! ¡Penalti a favor de {t}! ¡Derriban a {p}!'],
  penaltyMissed: ['¡Falla {p}! ¡No puede ser! ¡Penalti fallado!'],
  yellow: ['Amarilla para {p}.', 'Tarjeta para {p}, que tendrá que tener cuidado.'],
  secondYellow: ['¡Expulsado! ¡Segunda amarilla a {p}! ¡{t} se queda con diez!'],
  red: ['¡Roja! ¡Roja directa a {p}! ¡{t} con diez hombres!'],
  sub: ['Cambio en {t}: entra {p} por {o}.', 'Movimiento en el banquillo de {t}: {p} al campo, se retira {o}.'],
  subInjury: ['Mala noticia para {t}: se retira {o} lesionado, entra {p}.'],
  injury: ['¡Cuidado! {p} se ha quedado tendido… no tiene buena pinta.'],
  offside: ['Fuera de juego de {p}, levanta la bandera el asistente.'],
  corner: ['¡Córner para {t}! ¡Peligro!'],
  freeKick: ['¡Falta peligrosa para {t}! {p} se coloca…'],
  foul: ['Falta de {p} sobre {o}.'],
  mentality: ['{t} mueve el planteamiento. ¡Va a por todas!'],
  formation: ['{t} cambia el dibujo: {f}.'],
};

/** Analista: sobrio, táctico, preciso. */
const ROMAN: Bank = {
  kickOff: ['Comienza el partido. Veremos cómo se plantean los dos equipos.', 'Echa a rodar el balón. Interesante duelo táctico el que tenemos hoy.'],
  halfTime: ['Final de la primera parte, {s}. Habrá que ver los ajustes en el vestuario.', 'Descanso. {s}. El partido está muy condicionado por lo que se ha visto en el centro del campo.'],
  fullTime: ['Final del partido: {s}. Tocará analizar con calma lo que ha pasado.', 'Termina el encuentro, {s}.'],
  addedTime: ['{n} minutos de añadido, acorde con las interrupciones.'],
  extraTime: ['Prórroga. Aquí pesará mucho el físico y los cambios.'],
  shootout: ['Tanda de penaltis. Mucho de cabeza y de preparación.'],
  goal: ['¡Gol de {p}! Muy bien resuelto {how}. {s}.', '¡Gol! {p} {how}; la jugada nace de un buen movimiento de desmarque. {s}.', '¡Gol de {t}! {p} lo define con mucha calidad {how}. {s}.'],
  goalLate: ['¡Gol de {p} al final! Un golpe durísimo para {r} en el último momento. {s}.', '¡Gol en el tramo final! {p} castiga a {r} cuando parecía todo decidido. {s}.'],
  goalEqualizer: ['¡Gol de {p}! Empata {t}, y el partido cambia por completo. {s}.', '¡Igualada! {p} premia la insistencia de {t}. {s}.'],
  goalAhead: ['¡Gol de {p}! {t} se adelanta, y ahora {r} tendrá que dar un paso al frente. {s}.', '¡Gol! {p} pone por delante a {t}. Atención a cómo reacciona el rival. {s}.'],
  goalRout: ['Otro gol, obra de {p}. {t} está siendo muy superior. {s}.', '¡Gol de {p}! El partido está ya prácticamente resuelto. {s}.'],
  goalShootout: ['{p} marca. Buen lanzamiento, ajustado.', 'Gol de {p}, engaña bien al portero.'],
  save: ['¡Uyyy! Gran intervención de {p}, muy bien colocado ante el disparo de {o}.', '{o} lo intenta {how}; responde con seguridad {p}.', 'Buena parada de {p}. Ha leído muy bien la intención de {o}.'],
  woodwork: ['¡Al palo! Estaba bien ajustado el disparo de {p}.', '¡Larguero! Muy cerca estuvo {p}.'],
  blocked: ['Disparo de {p}, bien tapado por la defensa.', 'Lo prueba {p}, pero la defensa está muy bien cerrada.'],
  bigMiss: ['¡Uyyy! Ocasión clarísima para {p}, que no acierta {how}.', 'Se marcha fuera. {p} lo tenía todo para marcar {how}.'],
  penalty: ['Penalti a favor de {t}. Falta clara sobre {p}.'],
  penaltyMissed: ['Falla {p}. Lanzamiento poco ajustado.'],
  yellow: ['Amarilla para {p}. Tendrá que medir mucho a partir de ahora.', 'Tarjeta para {p}, falta táctica.'],
  secondYellow: ['Segunda amarilla para {p}. {t} se queda con diez; habrá que reorganizarse.'],
  red: ['Roja directa a {p}. Decisión que condiciona totalmente el partido. {t}, con diez.'],
  sub: ['Cambio en {t}: entra {p} por {o}. Busca piernas frescas.', 'Movimiento de banquillo en {t}: {p} por {o}.'],
  subInjury: ['Cambio obligado en {t}: se retira {o} con molestias, entra {p}.'],
  injury: ['{p} se ha quedado tocado. Atentos, porque puede necesitar el cambio.'],
  offside: ['Fuera de juego de {p}. Bien tirada la línea.'],
  corner: ['Córner para {t}. Atención a la estrategia.'],
  freeKick: ['Falta peligrosa para {t}. Buena posición para {p}.'],
  foul: ['Falta de {p} sobre {o}. Corta la transición.'],
  mentality: ['{t} cambia su planteamiento. Se nota en la altura del bloque.'],
  formation: ['{t} cambia el sistema a {f}. Ajuste táctico interesante.'],
};

const BANKS: Record<NarratorId, Bank> = { montes: MONTES, rivero: RIVERO, roman: ROMAN };

/** Frases para un momento: las del narrador, o las neutras si no tiene. */
export function phrases(narrator: NarratorId | 'neutral', m: Moment): string[] {
  if (narrator !== 'neutral') {
    const own = BANKS[narrator][m];
    if (own?.length) return own;
  }
  const n = NEUTRAL[m];
  // Los goles con contexto, sin frase propia, vuelven al gol normal
  return n.length ? n : NEUTRAL.goal;
}

/** Narrador de un partido según su semilla (al azar, pero reproducible). */
export function narratorFor(seed: number): NarratorId {
  return NARRATOR_IDS[Math.abs(Math.floor(seed)) % NARRATOR_IDS.length]!;
}
