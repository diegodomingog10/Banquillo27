# Guía de datos de Banquillo

Esta guía explica cómo conectar tu base de datos real al juego **sin tocar el motor**.
El contrato entre datos y motor es el esquema de `src/data/schema.ts` (validado con Zod):
cualquier fuente acaba convertida en un `WorldDatabase`.

```
Tus CSV/JSON ──► importador ──► (estadísticas → atributos) ──► valores estimados ──► WorldDatabase ──► motor
                    │                                                                      │
                    └── informe por fila (errores / avisos / info)                         └── verify-db
```

---

## 1. Importación rápida

```bash
npm run import -- data/examples
```

- Acepta una carpeta (lee todos los `.csv`, `.json`, `.tsv`) o una lista de archivos.
- Escribe `data/imported/world.json` y `data/imported/world.import-report.csv` (todas las incidencias).
- Código de salida `2` si hubo filas con error o la verificación falla.

Opciones:

| Opción | Efecto |
|---|---|
| `--out ruta.json` | Archivo de salida. |
| `--fill` | Completa plantillas con jugadores ficticios hasta `--min-squad` (22 por defecto) y crea staff para clubes sin él. Los añadidos llevan `estimated: ["generatedFill"]`. |
| `--min-squad 22` | Tamaño mínimo para `--fill`. |
| `--merge mundo.json` | Fusiona con una base existente (p. ej. un mundo generado con `npm run generate`). Lo importado con el mismo `id` reemplaza a lo existente. |
| `--mapping tabla.json` | Usa otra tabla de conversión estadísticas→atributos. |
| `--start 2026-07-01` | Fecha de inicio de partida (por defecto 1 de julio de 2026). |
| `--name "Mi base"` | Nombre que se muestra en el juego. |

Dentro del juego: **Importar base de datos** hace lo mismo (en un Web Worker) y muestra el informe con filtros.

Verificar cualquier base:

```bash
npm run verify-db -- data/imported/world.json
```

---

## 2. Archivos y tipos de entidad

El tipo de cada archivo se deduce de su nombre:

| Contiene en el nombre | Entidad |
|---|---|
| `player`, `jugador`, `plantilla`, `squad` | Jugadores |
| `club`, `team`, `equipo` | Clubes |
| `competition`, `league`, `liga`, `torneo` | Competiciones |
| `nation`, `country`, `pais`, `nacion` | Naciones |
| `staff`, `entrenador`, `coach` | Staff |

Un JSON con forma `{ "players": [...], "clubs": [...], "competitions": [...], "nations": [...] }` se
lee completo de una vez (ver `data/examples/example-database.json`). Un `world.json` exportado por
Banquillo también vale.

**Orden de resolución:** naciones → clubes → competiciones → jugadores → staff. No necesitas
todos los archivos: las naciones y ligas que solo aparecen como referencia se crean
automáticamente (y se informa con un mensaje `info`).

### Reglas generales

- **Cabeceras:** se ignoran mayúsculas, acentos, espacios y guiones: `birth_date`, `BirthDate`,
  `Fecha de nacimiento` y `fecha_nacimiento` son la misma columna. Se aceptan alias en inglés y español
  (lista completa en `src/data/importers/fields.ts`).
- **Separador CSV:** se detecta solo (`,` `;` tabulador `|`). Se admiten comillas, `""` y saltos de línea entre comillas. UTF-8 con o sin BOM.
- **Números:** `1250000`, `1.250.000`, `1,5`, `1.234,5`, `2.5M`, `800k`, `€ 3 000`, `85%`.
- **Fechas:** `AAAA-MM-DD` (recomendado) o `DD/MM/AAAA`.
- **Listas:** separadas por `;` (o `|`). Ej.: `nationality = ESP;ARG`.
- **Ids:** letras, números y `_ . : -`, máximo 64 caracteres. Si falta se genera uno a partir del nombre (aviso).
- **Referencias:** `club_id`, `nation`, `league_id`… pueden ser el **id o el nombre** del objeto referenciado.
- **Atributos en escala 1-100:** si un atributo vale entre 21 y 100 se divide entre 5 (aviso `info`).

### Qué pasa con una fila mala

| Situación | Resultado |
|---|---|
| Falta un campo obligatorio (nombre, nación del club) | **error**: la fila se descarta, el resto sigue. |
| `id` repetido | **error**: se conserva la primera aparición, se descarta la repetida (el mensaje indica archivo y fila de la original). |
| Mismo nombre + fecha de nacimiento con otro id / mismo nombre de club en la misma nación | **aviso** de posible duplicado (se importan ambos). |
| Valor con formato inválido (fecha, número) | **aviso**: se ignora ese valor y se estima. |
| Referencia a club inexistente | **aviso**: el jugador queda como agente libre. |
| Posición desconocida | **aviso**: se ignora esa posición. |

Cada incidencia lleva `severity`, `file`, `row` (línea del CSV contando la cabecera como 1; posición en el array para JSON), `entity`, `id`, `field` y `message`.

---

## 3. Formato por entidad

Solo las columnas en **negrita** son obligatorias. Todo lo demás se estima si falta y queda
registrado en el campo `estimated` de la entidad (p. ej. `["birthDate", "attributes.pace", "pa"]`).
La ficha del jugador muestra esos datos marcados como **dato estimado** (`*`).

### 3.1 Naciones (`nations.csv`)

| Columna | Tipo | Notas |
|---|---|---|
| **id** o **name** | texto | Si solo hay nombre, id = `n_<nombre>`. |
| code | texto (2-4) | Código corto. |
| continent | texto | |
| reputation | 0-10000 | Por defecto 5000. |
| league_strength | 0-100 | **Fuerza de la liga principal**. Clave para convertir estadísticas (ver §4). Por defecto `reputation/100` o 50. |
| mandatory_release_clause | sí/no | Si los contratos llevan cláusula obligatoria. |

### 3.2 Clubes (`clubs.csv`)

| Columna | Tipo | Notas |
|---|---|---|
| id | texto | Si falta: `cl_<nombre>` (aviso). |
| **name** | texto | |
| **nation** | id/código/nombre | Si no existe, se crea. |
| league_id | id/nombre de competición | Inscribe el club en esa liga (la crea si no existe, nivel 1). |
| short_name, city, founded | | |
| reputation | 0-10000 | Si falta: 60 % / 33 % / 20 % de la reputación de la nación según división 1 / 2 / 3+. |
| primary_color, secondary_color | `#rrggbb` | |
| home_shirt, home_secondary, home_pattern, home_shorts | `#rrggbb` o nombre (rojo, azul, blanco, granate, celeste…) | Primera equipación. Diseño: liso, rayas, finas, aros/franjas, mitades, banda, mangas. Si falta, se usan primary/secondary. |
| away_shirt, away_secondary, away_pattern, away_shorts | igual | Segunda equipación. Si falta, se deriva (aviso informativo). |
| gk_shirt | igual | Camiseta del portero. Si falta, se elige un color que no choque. |
| stadium, capacity, pitch_condition (0-100) | | Capacidad estimada por reputación. |
| training_facilities, youth_facilities, youth_recruitment, junior_coaching | 1-20 | Estimadas por reputación. |
| balance, transfer_budget, wage_budget (semanal), debt, revenue (anual) | € | Ingresos estimados con `2 M€ × e^(rep/1600)`. Presupuesto salarial estimado = suma de salarios × 1,1. |
| rivals | lista de ids/nombres | |

### 3.3 Competiciones (`competitions.csv`)

| Columna | Tipo | Notas |
|---|---|---|
| id / **name** | | Uno de los dos. |
| nation | id/nombre | Vacío = continental. |
| format | `league` · `cup` · `groupCup` · `playoff` (o `liga`, `copa`, `grupos`) | Por defecto `league`. |
| level | entero | 1 = primera división; copas 0. |
| reputation | 0-10000 | |
| strength | 0-100 | Fuerza explícita de esta liga (prioridad sobre la de la nación). |
| team_ids | lista | Clubes por id o nombre. También puede rellenarse desde `clubs.league_id`. |
| start_date, end_date | fechas | Por defecto 15-ago / 30-may. |
| promoted, relegated, up_competition_id, down_competition_id | | Ascensos/descensos. |

Reglas finas (desempates, grupos, premios…) se pueden dar en JSON con la misma forma que el esquema
(`rules`, `prizes`, `schedule.breaks`, `continentalSpots`); si faltan, se aplican los valores por
defecto del esquema.

### 3.4 Jugadores (`players.csv`)

**Identidad y físico**

| Columna | Tipo | Notas |
|---|---|---|
| id | texto | Si falta: generado a partir de nombre + fecha (aviso). |
| **first_name + last_name** o **name** | texto | `name` se parte por el primer espacio. Un solo nombre → también `common_name`. |
| common_name | texto | Nombre corto a mostrar. |
| birth_date | fecha | Si falta y hay `age`, se aproxima; si no, 26 años. |
| nationality | lista | La primera es la principal. Si falta: nación del club. |
| height_cm, weight_kg | números | Altura en metros (`1.82`) también vale. Por defecto según posición. |
| foot | `right`/`left`/`both` (`derecho`/`izquierdo`/`ambos`) | |
| foot_left, foot_right | 1-20 | Si faltan: pie hábil 20, malo 8. |
| club_id | id o nombre | Vacío = agente libre. |

**Posiciones** — códigos internos: `GK LB CB RB LWB RWB DM LM CM RM LW AM RW ST`.
También se aceptan alias ingleses (`CDM`, `CAM`, `CF`, `DL`, `DR`, `AML`…) y españoles
(`POR`, `DFC`, `LI`, `LD`, `MCD`, `MC`, `MI`, `MD`, `MP`, `EI`, `ED`, **`DC` = delantero centro**).
Para el sentido de FM-inglés de "D C" (defensa central) usa `CB` o `DFC`.

| Columna | Ejemplo | Interpretación |
|---|---|---|
| positions | `ST;LW` | Primera = natural (20); las demás 15 (marcadas como estimadas). |
| positions | `CB;LB:12` | Nivel explícito 1-20 por posición. |
| position_minutes | `ST:2400;RW:600` | Nivel = 10 + 10 × minutos / minutos de la posición principal (se ignoran posiciones con < 5 % del total). |

Si solo hay una posición, se añaden las afines más próximas (p. ej. `LB` → `LWB`) como estimadas.
Sin posiciones: portero si trae estadísticas de portero, si no mediocentro (aviso).

**Contrato y valor**

| Columna | Notas |
|---|---|
| wage | Salario **semanal** (o `annual_wage` anual). |
| contract_expires | Fecha. Por defecto, dentro de 2 temporadas. |
| release_clause | Si la nación tiene cláusula obligatoria y falta, se estima (3 × valor). |
| market_value | Estimado por CA, PA, edad, contrato y club si falta. |

**Habilidad y atributos**

| Columna | Notas |
|---|---|
| ca, pa | 1-200. Si se dan se respetan (aviso si la CA difiere > 20 de la calculada). Si faltan: ver §5. |
| Atributos | 1-20. Una columna por atributo con su nombre interno (`passing`, `first_touch`, `firstTouch`…) o su etiqueta española (`Pase`, `Primer toque`…). Lista completa abajo. |
| personality | Clave (`modelCitizen`) o etiqueta (`Ciudadano modelo`). Si falta se deriva de los atributos. |
| condition, morale | 0-100. |

Atributos (clave interna — etiqueta):

- **Técnicos:** corners — Córners · crossing — Centros · dribbling — Regate · finishing — Finalización · firstTouch — Primer toque · freeKicks — Faltas · heading — Juego de cabeza · longShots — Tiro lejano · longThrows — Saques largos · marking — Marcaje · passing — Pase · penalties — Penaltis · tackling — Entradas · technique — Técnica
- **Mentales:** aggression — Agresividad · anticipation — Anticipación · bravery — Valentía · composure — Serenidad · concentration — Concentración · decisions — Decisiones · determination — Determinación · flair — Creatividad · offTheBall — Sin balón · leadership — Liderazgo · positioning — Colocación · teamwork — Trabajo en equipo · vision — Visión · workRate — Entrega
- **Físicos:** acceleration — Aceleración · agility — Agilidad · balance — Equilibrio · jumping — Salto · naturalFitness — Forma natural · pace — Velocidad · stamina — Resistencia · strength — Fuerza
- **Portero:** aerialReach — Juego aéreo · communication — Comunicación · handling — Manejo · kicking — Saque · reflexes — Reflejos · oneOnOnes — Uno contra uno · playWithFeet — Juego con los pies
- **Ocultos:** consistency — Consistencia · importantMatches — Partidos importantes · injuryProneness — Propensión a lesiones · versatility — Versatilidad · ambition — Ambición · loyalty — Lealtad · professionalism — Profesionalidad · temperament — Temperamento

**Estadísticas reales** (ver §4)

| Columna | Notas |
|---|---|
| minutes | Minutos de la muestra. **Importante**: controla la fiabilidad. Si hay estadísticas sin minutos se asume muestra completa (info). |
| competition_id | Liga de la muestra (cohorte). Por defecto, la liga del club. |
| league_strength | 0-100, para forzar la fuerza de la liga de este jugador. |
| `<estadística>` | Cualquier nombre de `stats` en `src/data/statsMapping.json` (p. ej. `goals_p90`, `pass_completion_pct`). Columnas desconocidas se ignoran. |

Prioridad por atributo: **atributo explícito > atributo derivado de estadísticas > estimado**.

### 3.5 Staff (`staff.csv`, opcional)

Columnas: **id**, **first_name**, last_name, **role** (`manager`, `assistantManager`, `coach`,
`goalkeepingCoach`, `fitnessCoach`, `scout`, `chiefScout`, `physio`, `doctor`, `analyst`,
`youthCoach`, `directorOfFootball`), club_id, nationality, birth_date, reputation y cualquier
atributo de staff de `STAFF_ATTRS` en `schema.ts` (1-20, por defecto 10 estimado).
Con `--fill`, los clubes sin staff reciben uno ficticio completo.

---

## 4. Conversión de estadísticas a atributos (`statsToAttributes.ts`)

Tus datos traen estadísticas por 90 minutos, no atributos. La conversión es:

1. **Percentil por cohorte.** Para cada estadística se calcula el percentil del jugador
   **dentro de su liga y grupo posicional** (porteros, centrales, laterales, mediocentros
   defensivos, mediocentros, bandas, mediapuntas, delanteros). Así un central no compite en
   "goles por tiro" con delanteros.
   Si la cohorte tiene menos de `minCohortSize` (8) jugadores con ese dato, se compara con el
   mismo grupo posicional de **todas** las ligas; si aun así es pequeña, el percentil se
   acerca a 0,5 en proporción al tamaño. Empates cuentan la mitad.
   *Como se usan percentiles, las unidades no importan* (85 o 0,85 para un %, km o millas),
   siempre que sean coherentes dentro de la base de datos.
2. **Estadísticas inversas.** Si `higherIsBetter` es `false` (malos controles, pérdidas,
   errores, veces regateado), se usa `1 − percentil`.
3. **Mezcla ponderada.** Cada atributo combina percentiles según `statsMapping.json`.
   Ejemplo del enunciado:
   ```json
   "passing": { "outfield": { "pass_completion_pct": 0.45, "progressive_passes_p90": 0.35, "passes_completed_p90": 0.2 } }
   ```
   Si falta una estadística, sus pesos se **renormalizan** con las disponibles. Los atributos
   de portero solo usan la clave `"GK"`; los de campo, `"outfield"` (y opcionalmente `"GK"`
   para porteros, p. ej. `composure`).
4. **Fiabilidad por minutos.** `fiabilidad = (minutos − minMinutes) / (fullReliabilityMinutes − minMinutes)`,
   acotada a 0-1 (por defecto 180 y 1350). El percentil se encoge hacia 0,5:
   `p' = 0,5 + (p − 0,5) × fiabilidad × (0,5 + 0,5 × cobertura)`, donde cobertura es la fracción
   del peso disponible. Con menos de `minMinutes` no se convierte nada (todo estimado).
5. **De percentil a 1-20.** `z = probit(p')` acotado a ±`maxZ` (2,4), y
   `atributo = media_liga + desplazamiento_posición + z × sd_liga`.
   - `media_liga` y `sd_liga` salen de `leagueScale`, interpolada por la **fuerza de la liga**
     (0-100): en una liga de fuerza 100 la media es 13,2; en una de 50, 9,5; en una de 0, 5,5.
     Así el mejor pasador de una liga débil no recibe un 20.
   - `desplazamiento_posición` = `(importancia − 0,3) × positionOffsetSpread`, con la
     importancia del atributo para la posición (pesos de CA en `ability.ts`). Es la misma forma
     de perfil que usa el generador, por lo que jugadores reales y ficticios son comparables.
6. **Cuerpo.** Salto suma `(altura − 181)/8` y fuerza `(peso − 76)/10`.

**Fuerza de la liga** = `competition.strength` si existe; si no
`nation.leagueStrength × lowerDivisionFactor^(nivel − 1)` (0,8 por división); si no, 50.

**Lo que no sale de estadísticas** (atributos ocultos, determinación, liderazgo, forma natural,
equilibrio y cualquier atributo sin datos) se rellena de forma coherente con el nivel del jugador
(§5) y se marca como estimado.

### Editar la tabla

`src/data/statsMapping.json` es editable. Cada atributo tiene una nota con la decisión tomada.
Puedes:

- cambiar pesos o añadir estadísticas (declara primero la estadística en `stats` con
  `label` y `higherIsBetter`; la validación rechaza estadísticas no declaradas);
- ajustar `leagueScale`, `minMinutes`, `fullReliabilityMinutes`, `minCohortSize`, `maxZ`;
- usar una copia sin tocar el código: `npm run import -- datos --mapping mi-tabla.json`.

---

## 5. Valores estimados y cálculo de CA / PA

- **CA** (1-200) = 10 × media ponderada de los atributos visibles con los pesos de la posición
  principal (`POSITION_WEIGHTS` en `src/data/ability.ts`). Todo a 10 → CA 100.
  Si el archivo trae CA, se respeta; si no, se calcula. El nivel de la liga ya está incluido en
  los atributos convertidos (paso 5 anterior).
- **Atributos que faltan:** se generan con el mismo algoritmo que los jugadores ficticios
  (perfil de la posición, edad, altura y peso) apuntando a una CA objetivo: la CA declarada; o la
  calculada con los atributos conocidos (si hay ≥ 6); o el nivel típico del club por su reputación;
  o 70. Usan una semilla derivada del id, así que **reimportar produce exactamente lo mismo**.
- **PA:** si falta, `estimatePA` = CA + años hasta los 24 × (5 + ajuste por profesionalidad,
  determinación y ambición + ajuste por fuerza de liga), +3 entre 24 y 27 años. Nunca menor que CA.
- **Personalidad:** derivada de profesionalidad, determinación, ambición, lealtad y temperamento.

Todo lo estimado queda listado en `estimated` (p. ej. `attributes.pace`, `pa`, `contract.wage`).

---

## 6. Esquema de salida (`WorldDatabase`)

```ts
{
  schemaVersion: 1,
  meta: { name, source: 'generated' | 'imported' | 'mixed', seed, createdAt, startDate, season },
  nations: Nation[],
  clubs: Club[],            // la plantilla se deriva de Player.clubId
  players: Player[],
  staff: Staff[],
  competitions: Competition[],
}
```

Las definiciones exactas (campos, rangos, valores por defecto) están en `src/data/schema.ts`.
Partidos (`Match`) y mensajes (`Message`) también están definidos ahí; se generan durante la partida.

## 7. Ejemplos

`data/examples/` contiene la misma liga de 3 clubes × 3 jugadores en dos formatos:

- CSV: `nations.csv`, `competitions.csv`, `clubs.csv`, `players.csv` (con **estadísticas por 90**,
  como tus datos reales; un jugador con pocos minutos y otro casi sin datos para ver la estimación).
- JSON: `example-database.json` (con **atributos** parciales, CA/PA explícitas en un jugador).

```bash
npm run import -- data/examples/nations.csv data/examples/competitions.csv data/examples/clubs.csv data/examples/players.csv --fill
npm run import -- data/examples/example-database.json --out data/imported/ejemplo-json.json
```

## 8. Lista de comprobación para tu base real

> Para la base real de FC 27 + Transfermarkt ya preparada, ver la sección **Base de datos real (Fase 9)** del README (`npm run real-db`).


1. Exporta `clubs.csv` con `id`, `name`, `nation`, `league_id`, `reputation`.
2. Exporta `competitions.csv` con `id`, `name`, `nation`, `level` y, si puedes, `strength`.
3. Exporta `players.csv` con identidad, `club_id`, `positions` o `position_minutes`, `minutes` y
   las estadísticas por 90 que tengas (nombres de `statsMapping.json`, o renómbralas allí).
4. `npm run import -- carpeta --fill` y revisa `world.import-report.csv`.
5. `npm run verify-db -- data/imported/world.json`.
6. Ajusta `statsMapping.json` si los perfiles no te convencen y repite (es determinista).
