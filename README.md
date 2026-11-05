# Banquillo

Simulador de gestión de fútbol en el navegador: eres el entrenador, tomas decisiones
(tácticas, alineaciones, fichajes, entrenamiento, finanzas) y un motor de simulación resuelve
partidos y el paso del tiempo. Funciona 100 % en local, sin backend.

> **Estado: Fase 4 de 9 — interfaz base y tácticas.** Partida jugable temporada tras temporada con
> la interfaz definitiva (oscura con acento morado): menú principal, panel personalizable, bandeja,
> plantilla con vistas, perfil de jugador, tácticas con arrastrar y soltar, competiciones, club y
> buscador global. El partido en directo llega en la Fase 5.

## Requisitos e instalación

- Node.js 20 o superior (probado con 22).

```bash
npm install
npm run dev          # interfaz en http://localhost:5173
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite). |
| `npm run build` | Comprobación de tipos + build de producción en `dist/`. |
| `npm test` | Pruebas (Vitest). |
| `npm run typecheck` | Solo TypeScript. |
| `npm run generate -- --seed 42 [--nations 8]` | Genera un mundo ficticio en `data/generated/`. |
| `npm run import -- ruta/datos [--fill] [--merge mundo.json]` | Importa tu base de datos real (ver [DATA_GUIDE.md](DATA_GUIDE.md)). |
| `npm run verify-db -- ruta/world.json` | Verifica rangos, referencias y plantillas de una base. |
| `npm run calibrate -- [--matches 5000] [--level 120] [--draw 0.3]` | Simula N partidos entre equipos iguales y compara métricas con los objetivos. |
| `npm run experiments -- [--n 1500]` | Mide el efecto de decisiones (mentalidad, cambios, carácter, jugar con 10, ritmo, rol). |

## Estructura

```
src/
  engine/        Motor puro en TypeScript (sin React, ejecutable en Web Worker)
    rng.ts               Aleatoriedad con semilla (mulberry32)
    matchEngine.ts       Motor de partido por fases (MatchSimulation, simulateMatch)
    engineConfig.ts      Constantes de calibración y probabilidad logística
    tactics.ts           Formaciones, instrucciones, ajustes rápidos y gritos
    lineup.ts            Alineación, banquillo y lanzadores automáticos
    calendar.ts          Fechas de temporada, liga todos contra todos, jornadas y parones
    standings.ts         Clasificación con criterios de desempate
    game.ts              Estado de la partida y bucle «Continuar» (temporadas, copas, playoffs)
    views.ts             Vistas serializables para la interfaz
  data/
    schema.ts            Esquema Zod: Player, Club, Staff, Nation, Competition, Match, Message, WorldDatabase
    attributes.ts        Catálogo de atributos (técnicos, mentales, físicos, portero, ocultos)
    positions.ts         Posiciones, grupos, afinidades y alias de importación
    ability.ts           CA/PA, personalidad, valor de mercado y salario
    roles.ts             40 roles tácticos con pesos de atributos y comportamiento
    statsToAttributes.ts Conversor estadísticas reales → atributos 1-20
    statsMapping.json    Tabla de pesos editable (documentada)
    verify.ts            Verificación de bases de datos
    generator/           Mundo ficticio con semilla (naciones, ligas, clubes, plantillas, staff)
    importers/           CSV/JSON, alias de columnas, importador con informe por fila
  store/         Estado de la interfaz (Zustand), clientes de los Workers y guardado (Dexie)
  workers/       Workers: datos (generar/importar) y partida (estado, bucle, partidos, guardado)
  ui/            Pantallas y componentes React
  i18n/          Traducciones (es.ts); t('attr.passing')
tests/           Pruebas unitarias y de integración (Vitest)
scripts/         CLI: generate, import, verify-db
data/examples/   Ejemplo de 3 clubes × 3 jugadores en CSV y JSON
```

## Reglas del proyecto

- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`).
- **Nunca `Math.random()`**: todo lo aleatorio usa `createRng(semilla)` (`src/engine/rng.ts`); `rng.fork(etiqueta)`
  crea subflujos deterministas. Mismo mundo + misma semilla = mismo resultado.
- El motor y la capa de datos no dependen de React y se ejecutan en Web Workers.
- Todos los textos visibles están en `src/i18n/es.ts`.
- Datos de ejemplo 100 % inventados: naciones, ligas, clubes y jugadores ficticios.

## Mundo ficticio (generador)

`generateWorld({ seed })` crea, de forma determinista y en ~0,4 s:

- 8 naciones del continente inventado *Aurelia*, cada una con su estilo de nombres
  (ibérico, nórdico, eslavo, itálico, germánico, lusófono, franco, anglo);
- 2 divisiones de 20 clubes por nación (320 clubes) con reputación, estadio, instalaciones,
  finanzas, objetivos de la directiva, filosofía y rivales;
- plantillas de 25 jugadores (8.000 + ~120 agentes libres) con CA/PA según la reputación del club,
  rol en la plantilla (titular, rotación, suplente, canterano) y edad;
- staff completo por club (15 miembros), copa nacional por país y dos torneos continentales.

Los atributos se generan a partir de la CA objetivo y del perfil de la posición, y la CA final se
**recalcula** a partir de los atributos, así que ambas son siempre coherentes.

## Motor de partido (Fase 2)

`simulateMatch(input)` o, para verlo en directo, `new MatchSimulation(input)` con `step()`,
`runToMinute(m)` y `command(lado, orden)` (cambios, táctica, mentalidad, ajustes, gritos).

- **Cuadrícula 5 × 8** vista desde el equipo que ataca; ~200 fases de posesión por partido. En
  cada fase hay portador, zona e intención: pase corto, progresivo, largo, al hueco, regate,
  centro o tiro, elegida según zona, rol (`roles.ts`), instrucciones, mentalidad, marcador y minuto.
- **Resolución logística:** `p = 1 / (1 + exp(-((ataque − defensa)/k + sesgo)))`, con ataque y
  defensa como mezclas de atributos efectivos y `k = 5,5` (`engineConfig.ts`).
- **Atributos efectivos:** condición física (los físicos caen el doble que el resto), moral, forma,
  consistencia (forma del día), partidos importantes, posición natural, familiaridad táctica,
  ventaja de campo (escala con el público), césped, clima y estado mental del equipo.
- **Fatiga:** por rol (`workload`), laterales y extremos, intensidad de presión, ritmo,
  resistencia y forma natural; sprints y duelos gastan más. La IA cambia a los cansados.
- **Tiros y xG:** xG base por franja, carril y tipo (abierto, lejano, cabeza, córner, mano a mano,
  falta, penalti) × calidad del finalizador × portero rival; contraataques +20 %.
- **Eventos** con minuto, periodo, descuento, equipo, jugadores y coordenadas: gol, tiro, parada,
  palo, falta, amarillas y rojas, fuera de juego, córner, falta peligrosa, penalti, lesión, cambio,
  descanso, tiempo añadido, prórroga, penaltis, cambios tácticos y gritos. En modo `full` además
  se guarda la repetición acción a acción (`replay`) para la vista 2D.
- **IA en partido:** perdiendo adelanta línea, sube presión, ritmo y mentalidad; ganando se cierra;
  grita al descanso y hace hasta 5 cambios en 3 ventanas (cansancio, lesiones).
- **Determinismo:** misma semilla = mismo partido, y `fast` (resto de la liga) da exactamente el
  mismo resultado que `full`; solo omite la repetición. ~7 ms por partido.

### Calibración (`npm run calibrate`, 5.000 partidos, nivel 120)

| Métrica | Resultado | Objetivo |
|---|---|---|
| Goles por partido | 2,55 | ≈ 2,6 |
| Ventaja local | +0,32 goles | ≈ 0,3 |
| Tiros (a puerta) | 25,3 (9,6) | ≈ 25 |
| xG por partido | 2,54 | ≈ goles |
| Empates | 26,6 % | ajustable |
| Córners · faltas · amarillas · rojas | 9,6 · 20,6 · 3,7 · 0,15 | 10 · 22 · 3,8 · 0,15 |
| Penaltis · fueras de juego · lesiones | 0,19 · 4,1 · 0,25 | 0,25 · 4 · 0,2-0,4 |
| Pases (precisión) · posesión local | 732 (81 %) · 51,2 % | ≈ 800 (80 %) · 50-52 % |
| Equipo con +25 de CA | gana 85 %, empata 12 % | favorito claro |

### Las decisiones importan (`npm run experiments`)

Cada fila usa las mismas semillas: todo es idéntico hasta el momento de la decisión.
Además, `tests/decisions.test.ts` impide que estas relaciones se rompan en el futuro.

- **Mentalidad = bloque defensivo.** Mueve la altura de la línea y de la presión y la posición
  sin balón. La **compacidad** (defensores cerca del balón) dificulta entrar, empeora los tiros y
  aumenta los bloqueos, pero con el área cerrada el rival tira más de lejos y centra más.
  Con 1-0 en el 70': muy defensiva → el rival tira más (3,8 frente a 3,2) con peores ocasiones
  (xG/tiro 0,081 frente a 0,101) y tú casi no atacas; **no es un seguro** (el rival marca en el
  28 % de los casos frente al 27 %). Muy ofensiva → más goles propios (0,50 frente a 0,37) y
  contras rivales más peligrosas (xG/tiro 0,119).
- **Tensión y carácter.** Al final de partidos ajustados o importantes, los jugadores agresivos y
  de temperamento bajo cometen más faltas y ven más tarjetas; amonestados, se cortan menos.
  Suplente caliente en el 70' con 1-0: 15,6 % de amarilla y 1,1 % de roja (tranquilo: 4,1 % y 0,1 %).
- **Jugar con 10:** marca un 29 % menos y encaja un 27 % más (−0,68 goles en 90').
- **Ritmo de partido:** penaliza atributos, acelera la fatiga y sube el riesgo de lesión
  (diferencia de goles +0,28 con ritmo 95 frente a −0,19 con 30).
- **Rol y piernas frescas:** la participación depende del rol, del deber y del cansancio
  (recuperador 14 acciones defensivas por 90' frente a 8 del mediapunta); los duelos de velocidad
  usan atributos efectivos, de modo que el suplente fresco gana más regates.

**Empates:** el enunciado pide "10 % de empates ajustable". Con ~2,6 goles entre equipos iguales,
la estadística da de forma natural un 25-28 % (como en el fútbol real), así que el valor por
defecto queda en ese rango y el porcentaje se ajusta con `drawAversion` (0-4): con empate a partir
del 65', ambos equipos arriesgan más. Medido: 0 → 29 %, 0,3 (defecto) → 26 %, 1 → 23 %,
2 → 18 %, 3,5 → 14 %. Bajar del ~12 % exigiría distorsionar el resto de métricas.

## Partida y calendario (Fase 3)

- **Nueva partida:** mundo ficticio o base de datos importada → país, liga, club y perfil del
  entrenador. La directiva da la bienvenida con los objetivos (mensaje que bloquea el tiempo hasta
  leerlo).
- **«Continuar»** (botón arriba a la derecha, o Ctrl+Intro) avanza día a día y se detiene en:
  partido del usuario, mensaje importante o pendiente de respuesta, sorteo de copa en el que
  participas, último día de mercado, fin de temporada y nueva temporada.
- **Calendario:** ligas a doble vuelta (método del círculo, equilibrio local/visitante) en el día
  preferido, saltando los 4 parones internacionales y la pausa invernal de cada liga; si no
  caben, se añaden jornadas entre semana evitando las fechas de copa. Ventanas de mercado
  (1 jul-1 sep y enero) con avisos y parada el último día.
- **Copa nacional:** eliminatoria a partido único con ronda previa si hace falta (exentos los de
  más reputación), sorteos como evento con todos los emparejamientos, el de menor categoría juega
  en casa, prórroga y penaltis.
- **Clasificación:** puntos, diferencia, goles, enfrentamiento directo y sorteo (según las reglas
  de cada competición), forma de los últimos 5, zonas de ascenso, playoff y descenso.
- **Fin de temporada:** campeones al historial, informe de la directiva (objetivo cumplido o no),
  2 ascensos directos + playoff (3.º-6.º, a partido único) y 3 descensos; el 1 de julio comienza
  la nueva temporada con nuevo calendario y objetivos.
- **Tras cada partido:** condición física, ritmo, moral, forma, estadísticas de temporada por
  competición, lesiones (con baja y alta médica), sanciones (roja directa 2 partidos, doble
  amarilla 1, cada 5 amarillas 1) y mensajes al usuario.
- **Rendimiento:** todo corre en un Web Worker; la interfaz solo recibe vistas. Una jornada de una
  liga de 20 equipos tarda ~80 ms; un día con las 16 ligas, ~1-2 s.
- **Guardado:** partidas en IndexedDB (Dexie), con guardado automático tras cada partido del
  usuario; exportación e importación como archivo JSON validado.

## Interfaz (Fase 4)

- **Diseño:** fondo casi negro con matiz violeta, un único acento morado para acción, selección y
  escala de atributos, tipografías Manrope (títulos) e Inter (datos) servidas en local, iconos de
  línea propios (`src/ui/icons.tsx`) y componentes base en `src/ui/kit.tsx`. Prototipos aprobados en
  el lienzo de diseño de la Fase 4.
- **Colores con significado fijo:** verde = bien (victoria, condición/ritmo/moral ≥ 85 %, objetivo en
  camino, nota ≥ 7,2), ámbar = atención (70-84 %, objetivo ajustado), rojo = mal (derrota, lesión,
  valores bajos), gris = empate o neutro.
- **Menú principal:** continuar la última partida, nueva partida, importar base de datos, generar
  mundo, opciones (tamaño de letra, guardado automático) y lista de partidas guardadas.
- **Panel de inicio:** mosaicos (próximo partido, clasificación, forma, objetivos con su estado,
  bajas, finanzas, noticias) que se reordenan arrastrando o con flechas y se ocultan; la
  disposición se guarda con la partida.
- **Plantilla:** vistas General, Técnica, Mental, Física, Contratos y Estadísticas, columnas
  configurables, vistas propias guardadas, orden por cualquier columna, filtros por línea y texto,
  selección múltiple con acciones en bloque (comparar, lista de seguimiento) y comparador.
- **Perfil de jugador:** nivel y potencial en puntos (relativos a la plantilla, como las estrellas
  de FM), atributos con color por nivel y `*` en los estimados, radar frente a la media de su
  posición en la liga, posiciones en un minicampo, estado físico, informe del cuerpo técnico con
  puntos fuertes y débiles, historial y comparación.
- **Tácticas:** campo con arrastrar y soltar (y alternativa con teclado: elegir posición y «Poner»),
  12 formaciones, mentalidad en 7 pasos, instrucciones por fases (con balón, sin balón,
  transiciones), rol, deber e instrucciones individuales por jugador con su idoneidad, banquillo,
  lanzadores y capitán, análisis del rival y **familiaridad táctica** (crece con los días y los
  partidos; cambiar de sistema la reduce). La alineación elegida se usa en los partidos; si alguien
  no está disponible, el asistente lo sustituye y avisa en la previa.
- **Buscador global (Ctrl+K)** de jugadores, clubes y pantallas; los nombres de jugadores y clubes
  son enlaces en toda la interfaz y el botón «Volver» recorre el historial.
- **Accesibilidad:** todo es operable con teclado, contraste suficiente y tamaño de letra ajustable
  (se recuerda entre sesiones).
- Las secciones Entrenamiento, Fichajes y Finanzas aparecen en el menú marcadas con su fase; los
  botones de mercado (renovar, ofrecer, ceder) están desactivados hasta la Fase 6.

## Decisiones de diseño (ambigüedades resueltas)

Cuando el enunciado era ambiguo se ha elegido lo más parecido a Football Manager:

- **Atributos en forma plana** (`player.attributes.passing`) en lugar de anidados por grupo: el
  motor los lee miles de veces por partido. Los grupos están en `attributes.ts`.
- **Códigos de posición internos neutros** (`GK`, `CB`, `ST`…) para evitar la ambigüedad "DC"
  (defensa central en FM inglés, delantero centro en español). En pantalla se muestran en español
  (POR, DFC, DC…). En importación `DC` = delantero centro.
- **Escala de CA lineal**: CA = 10 × media ponderada de atributos según la posición. Fácil de
  invertir (generador) y de explicar (importador). La reputación de club usa 0-10000 como FM.
- **Plantilla derivada de `Player.clubId`** (no se duplica la lista en el club).
- **Salarios semanales** y dinero en euros, como en FM.
- **Ascensos**: en segunda división, `promoted: 3` y `playoffPositions: [3,4,5,6]` significa
  2 ascensos directos + 1 por playoff entre 3.º-6.º (se implementa en la Fase 3).
- **Torneos continentales** con formato `groupCup` (grupos de 4, evitando mismo país). El formato
  "fase de liga" tipo FM27 se valorará en la Fase 8.
- **Contratos que vencen:** hasta la Fase 6 (contratos y mercado) se prorrogan automáticamente
  dos años al cambiar de temporada, y se avisa al usuario.
- **Torneos continentales:** están definidos en la base de datos, pero su calendario (grupos con
  bombos y eliminatorias) llega en la Fase 8, junto con las selecciones nacionales.
- **Partidos de la IA:** se guarda un resumen (eventos clave y estadísticas básicas); los del
  usuario se guardan completos (alineaciones, eventos, estadísticas y notas).

## Plan de fases

1. ✅ Esquema de datos, generador ficticio, importador y DATA_GUIDE.md.
2. ✅ Motor de partido (sin interfaz), script de calibración y pruebas.
3. ✅ Calendario, ligas, clasificación, bucle "Continuar" y bandeja de entrada.
4. ✅ Interfaz base (menú, panel, plantilla, perfil) y tácticas.
5. Pantalla de partido (2D, feed, estadísticas, ajustes, gritos) y post-partido.
6. Fichajes, scouting, contratos, finanzas y directiva.
7. Entrenamiento, lesiones, moral, progresión y fin de temporada.
8. IA de clubes, copas y torneos continentales, día de cierre, Data Hub y pulido.
9. Conexión de la base de datos real: importar, convertir, verificar y calibrar.
