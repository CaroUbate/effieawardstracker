# Marcador Effie 2026 · Bavaria

Sitio móvil para seguir en vivo los puntos de Bavaria (anunciante) y DraftLine
(agencia) durante la gala Effie Colombia 2026, el 9 de septiembre.

Ya viene precargado con **226 finalistas de Effie Colombia 2026** — el
listado completo, las 52 categorías — sacado del [timeline público de
finalistas](https://app.effiecolombia.com/dashboard/timeline_finalistas_2026.php)
de Effie Colombia: las 42 ideas de Bavaria y otras 184 de otros anunciantes y
agencias (Alpina, Netflix, Postobón, Diageo, Nu, Nequi, Burger King, Colombina,
Mercado Libre, y muchos más). Todas parten en estado "Finalista" hasta que se
actualicen a Bronce / Plata / Oro / Gran Effie durante la ceremonia.

Cómo funciona:
- Cualquiera puede **ver** el marcador abriendo el link, con o sin señal.
- Cualquiera puede **agregar un metal** por el formulario compartido (recomendado)
  o, si no hay señal en ese momento, desde el botón "Agregar metal" del sitio,
  que lo guarda en ese teléfono como respaldo hasta que alguien lo pase al
  formulario.
- La app funciona sin internet para *ver* el último resultado conocido (queda
  guardado en el teléfono); para *agregar* un metal por el formulario
  compartido sí hace falta algo de señal (datos del celular alcanza, no
  necesita el wifi del sitio).

## 1. Prepara la fuente de datos compartida (10 minutos, antes del 9 de sept)

Esto reutiliza el mismo patrón que ya usan en THE GREATS (formulario → hoja
de cálculo → sitio), con Google Forms + Google Sheets, que es el más simple
de dejar leyendo en vivo desde una página externa.

**a. Crea el formulario** en Google Forms con estos campos, en este orden,
todos como **pregunta abierta** (respuesta corta) — así queda libre para
anotar cualquier marca, agencia o categoría que se anuncie en la gala, no
solo las de Bavaria:
1. Marca (respuesta corta)
2. Campaña (respuesta corta)
3. Categoría (respuesta corta)
4. Agencia líder (respuesta corta) — ej. "DraftLine" o "DraftLine / TBWA"
5. Agencia contribuyente (respuesta corta, opcional)
6. Metal ganado (opción múltiple: Finalista, Bronce, Plata, Oro, Gran Effie)
7. Tu nombre (respuesta corta, opcional)

**b. Conecta el formulario a una hoja de cálculo** (Respuestas → ícono de
Sheets → Crear hoja de cálculo nueva).

**c. Publica esa hoja a la web como CSV**: en la hoja de respuestas,
Archivo → Compartir → Publicar en la Web → elige la pestaña de respuestas →
formato **Valores separados por comas (.csv)** → Publicar. Copia el link que
te da (algo como
`https://docs.google.com/spreadsheets/d/e/.../pub?output=csv`).

**d. Pega ese link** en `data/config.json`, reemplazando
`"PEGA_AQUI_LA_URL_CSV_PUBLICADA"` por la URL real. Guarda el archivo.

**e. Conecta el botón "Actualizar aquí" directamente al formulario, sin salir
del sitio.** El sitio ya trae su propio formulario nativo (mismo diseño del
resto de la app) que envía la respuesta al formulario de Google por debajo,
sin redirigir a nadie a Google Forms. Para activarlo necesitas los
`entry.XXXXXXX` de cada pregunta:

1. Abre tu formulario de Google → menú ⋮ → "Obtener enlace para
   prellenar" → responde cualquier cosa en cada campo → "Obtener enlace".
2. Copia ese enlace larguísimo y busca los pares `entry.123456789=algo` — hay
   uno por pregunta, en el mismo orden en que las creaste.
3. En `data/config.json`, dentro de `"envioDirecto"`:
   - `"activo": true`
   - `"formActionUrl"`: la parte del enlace antes de `/viewform` cambiada a
     `/formResponse` (ej. `https://docs.google.com/forms/d/e/TU_ID/formResponse`)
   - en `"entryIds"` pega cada `entry.XXXXXXX` en el campo que le corresponde
     (marca, campana, categoria, agenciaLider, agenciaContribuyente, metal,
     autor).
4. Guarda. El botón "Enviar" del sitio ahora manda la respuesta directo a tu
   hoja, y además la guarda al instante en el teléfono de quien la cargó (así
   la ve de una, sin esperar la sincronización).

Si no alcanzas a configurar esto antes del evento, el formulario nativo
sigue funcionando igual: cada entrada queda guardada en el teléfono de quien
la carga y se ve reflejada ahí mismo, solo que no se comparte automáticamente
con los demás hasta que se sincronice manualmente.

Nota sobre cómo se cuentan los puntos de una entrada nueva: el sitio busca en
las 42 entradas precargadas una que coincida por marca + campaña + categoría
y le actualiza el metal (así no se duplica). Si no encuentra coincidencia
(por ejemplo alguien registra el metal de otra marca u otra agencia), la
agrega como entrada nueva — y si esa marca no es de Bavaria, aparece como su
propio anunciante en "Anunciante del Año" (útil para ir anotando lo que
ganan otros mientras se anuncia en la gala, ya que la pregunta queda abierta
a cualquier marca/agencia/categoría). Por eso conviene escribir el nombre de
la campaña tal cual aparece en el shortlist oficial cuando sea de Bavaria —
el formulario nativo sugiere campañas ya conocidas apenas escribes la marca.

## 2. Publica el sitio (igual que THE GREATS)

Sube esta carpeta (`site/`) a un repositorio de GitHub y activa GitHub Pages,
igual que se hizo con `linatorresmo.github.io/the-greats`. Comparte el link
con el equipo — pueden guardarlo en la pantalla de inicio del celular
("Agregar a inicio" / "Instalar app") para que abra como una app y funcione
sin conexión.

## 3. Sistema de puntos

Tabla oficial usada (igual a la del histórico de Bavaria en `Effie_2026.xlsx`):

| Metal        | Puntos |
|--------------|-------:|
| Finalista    |      2 |
| Bronce       |      6 |
| Plata        |     12 |
| Oro          |     24 |
| Gran Effie   |     48 |

Los puntos de **Bavaria como anunciante** se cuentan completos para
cualquiera de sus marcas (Poker, Pilsen, Aguila, Aguila Light, Costeña, Club
Colombia, TaDa, Corona, BEES, Pony Malta, Redd's, Budweiser, Cola & Pola,
Stella Artois, Bavaria corporativa), sin importar qué agencia haya liderado
el caso.

Los puntos de **agencia** (DraftLine, David, TBWA, etc.) se cuentan por
separado: completos si la agencia aparece como líder, la mitad si aparece
como contribuyente. Esto reconstruye el mismo criterio que usa la hoja
"Shortlists 2026" del Excel.

**Importante**: el marcador solo puede sumar los puntos de las entradas que
el equipo va cargando aquí. No tenemos visibilidad de los shortlists de
otros anunciantes ni de otras agencias (por eso el ranking de "Agencia del
Año" que se ve en el sitio es una comparación entre las agencias que
trabajan con marcas Bavaria — David, DraftLine, TBWA, etc. — no el ranking
oficial de toda la industria, que Effie/ANDA publica después del evento).

## 4. Qué trae la app

- **Home**: logos de Effie 20 años y Bavaria arriba, contador de Shortlists /
  Bronce / Plata / Oro, y tres carreras (Anunciante del Año, Agencia del
  Año, Marca del Año) con barras que se recalculan solas. Un botón "ⓘ cómo se
  cuentan los puntos" explica la tabla de puntos y la regla de agencia
  líder/contribuyente en cualquier momento.
- **Buscar marca**: al final del Home, escribe o elige una marca y entra a su
  ficha — contador de metales propio y el detalle de cada idea con sus
  puntos.
- **Actualizar aquí**: abre el formulario nativo (Marca, Campaña, Categoría
  con el listado oficial de categorías Effie, Agencia líder, Agencia
  contribuyente, Metal) que guarda al instante en el teléfono y, si está
  configurado, lo manda también a la hoja compartida.

## 5. Archivos

- `index.html`, `style.css`, `app.js` — el sitio (tres vistas: Home, ficha de
  marca y formulario).
- `manifest.json`, `sw.js` — para que funcione como app instalable y sin
  conexión.
- `assets/effie20-logo.png`, `assets/bavaria-logo.png` — los logos que diste.
- `data/config.json` — tabla de puntos, marcas de Bavaria, alias de agencias,
  categorías oficiales, y los dos links a configurar antes del evento
  (`sync.csvUrl` para leer, `envioDirecto` para escribir sin salir del sitio).
- `data/seed-entries.json` — las 226 ideas finalistas de 2026 precargadas
  (todos los anunciantes y agencias, tomadas del timeline público de Effie
  Colombia), con el metal en "Finalista" hasta que se actualicen.
