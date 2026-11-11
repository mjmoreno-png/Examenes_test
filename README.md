# Exámenes tipo test con penalización

Aplicación web **gratuita** para publicar exámenes tipo test (por ejemplo, de Física y Química), compartirlos con un enlace y recibir los resultados ya corregidos **con penalización por error**.

- Los alumnos **no necesitan cuenta**: abren el enlace, escriben su nombre, apellidos y grupo, y hacen el examen (también desde el móvil o el iPad).
- Los errores restan y las preguntas en blanco no. La **penalización por error** (siempre una fracción de punto: 1/3, 1/4, 2/5…) la eliges tú al publicar cada examen.
- Las preguntas pueden llevar **imágenes** (gráficas, esquemas, fotos), y el examen puede **vigilar si el alumno sale de la pantalla**.
- La corrección se hace en el servidor (Google Apps Script), no en el navegador del alumno.
- Los resultados se guardan en una hoja de cálculo de Google tuya.

```
Alumno  ──>  GitHub Pages (index.html?e=ID)  ──>  Google Apps Script  ──>  Google Sheets
Profesor ──> GitHub Pages (admin.html)       ──>  Google Apps Script  ──>  Google Sheets
```

> **Importante:** el repositorio de GitHub es **público** (GitHub Pages gratis lo exige). Por eso **nunca** debe contener las soluciones de tus exámenes ni el token. Las soluciones viven solo en tu hoja de Google. El archivo `.gitignore` ya excluye `*.gift` y `*.txt`.

---

## Instalación paso a paso

Tardarás unos 20 minutos. Necesitas una cuenta de Google y una de GitHub.

### Parte 1. Crear tu copia del repositorio

1. Entra en el repositorio en GitHub y pulsa **Fork** (arriba a la derecha) para tener tu propia copia, o crea un repositorio nuevo y sube estos archivos. Cada profesor debe tener **su propia copia, su propia hoja de Google y su propio token**: así nadie ve las soluciones ni las notas de otro.
2. Comprueba que el repositorio es **público**.

### Parte 2. La hoja de cálculo y el script (backend)

1. Entra en <https://sheets.google.com> y crea una hoja en blanco llamada, por ejemplo, **Exámenes test**. No hace falta crear pestañas: el script las crea solo.
2. En la hoja: **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs` y pega todo el contenido del archivo [`apps-script/Code.gs`](apps-script/Code.gs). Guarda (icono del disquete).
4. **Crea el token de administración** (es la «contraseña» del panel del profesor):
   - Rueda dentada **Configuración del proyecto → Propiedades de la secuencia de comandos → Añadir propiedad**.
   - Propiedad: `ADMIN_TOKEN`. Valor: una contraseña larga y difícil de adivinar (que no uses en ningún otro sitio). Guardar.
   - Nunca escribas el token en el código ni lo subas a GitHub.
5. **Da permisos** (solo la primera vez): en el desplegable de funciones elige `setup`, pulsa **Ejecutar** y autoriza (*Revisar permisos → tu cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*). El aviso de «aplicación no verificada» es normal: es tu propio script. Comprueba que ha aparecido la pestaña `Examenes`.
6. **Despliega la aplicación web:**
   - **Implementar → Nueva implementación**, tipo **Aplicación web**.
   - **Ejecutar como:** *Yo*. **Quién tiene acceso:** *Cualquier usuario*.
   - **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
7. Comprueba que funciona: abre en el navegador `LA_URL?action=list&token=TU_TOKEN`. Debe responder `{"ok":true,"exams":[]}`.

### Parte 3. Conectar la web con el script

1. En tu repositorio, edita el archivo [`js/config.js`](js/config.js) (en GitHub: abrir el archivo → icono del lápiz) y **sustituye la URL que trae por la tuya** (el repositorio original lleva la de su autor):

   ```js
   export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
   ```

   Esa URL **no es un secreto**: la ve cualquiera que abra un examen. El token, en cambio, nunca va aquí.
2. Guarda el cambio (**Commit changes**).

### Parte 4. Activar GitHub Pages (frontend)

1. En el repositorio: **Settings → Pages**.
2. En *Build and deployment*: **Source: Deploy from a branch**; **Branch: `main`** (o la rama donde estén los archivos) y carpeta **`/ (root)`**. **Save**.
3. Espera uno o dos minutos. GitHub te mostrará la dirección, del estilo `https://TU_USUARIO.github.io/NOMBRE_REPO/`.
4. Tu panel está en `…/admin.html`. Ábrelo, escribe tu token y ya puedes publicar.

---

## Uso diario

### Preparar un examen (formato GIFT)

Escribe las preguntas en un archivo de texto con este formato (la respuesta correcta lleva `=`, las incorrectas `~`):

```
// Los comentarios empiezan por //
::P01::¿Qué nos convierte en científicos?{
=El modo en que buscamos respuestas
~Trabajar en un laboratorio
~Usar fórmulas matemáticas
~Tener un título universitario
}

::P02::¿Cuánto es 2 + 2?{
~3
=4
~5
}
```

**Reglas del formato:**
- Una pregunta por bloque; los bloques se separan con una línea en blanco.
- El título `::P01::` es opcional.
- Cada pregunta tiene **exactamente una** opción correcta (`=`) y al menos dos opciones en total.
- Si exportas desde Moodle, los pesos `%-33.33333%` se ignoran: la penalización la calcula la aplicación.
- Para escribir los caracteres `: = ~ # { }` dentro de un texto, ponles delante una barra invertida (`\=`, `\{`…).

**Guarda estos archivos fuera del repositorio** (llevan las soluciones). El `.gitignore` bloquea `*.gift` y `*.txt`, pero lo más seguro es no ponerlos nunca en la carpeta del proyecto.

### Puntos por pregunta, preguntas abiertas y de respuesta corta

**Cuántos puntos vale cada pregunta.** Se escribe en el propio GIFT con la marca `[valor=N]` **al principio del enunciado** (justo después del título `::…::`, si lo hay). Si no la pones, la pregunta vale **1**. Acepta enteros y decimales (`2`, `0,5`, `0.5`, `1/2`), mayores que 0 y como mucho 100. También vale `[puntos=N]`.

```
::P01::[valor=2] ¿Cuánto es 2 + 2?{
~3
=4
~5
}
```

**Preguntas abiertas.** Una pregunta con las llaves **vacías** `{}` es abierta: al alumno se le muestra un cuadro de texto (hasta 4 000 caracteres) donde escribe su respuesta. En ese cuadro **no se puede pegar, copiar, cortar ni arrastrar texto**; cada intento de pegar queda contado en la columna `pegados` de la hoja. (Nadie puede impedir que alguien teclee algo que lee en otro dispositivo: el control real es que el examen esté vigilado y que corrijas tú.)

```
::A01::[valor=3] Explica con tus palabras qué es el método científico.{}
```

**Cómo se reparte la nota.** La nota final siempre es **sobre 10**: `nota = puntos obtenidos / suma de los valores de TODAS las preguntas × 10`. Por ejemplo, 20 preguntas de test a 0,4 puntos y 2 abiertas de 1 punto suman 10 puntos en total; no hace falta que los valores sumen 10, la aplicación proporciona. En el panel, al cargar el GIFT, aparece el **reparto de puntos** (test, abiertas, total) y cada pregunta lleva su valor.

**La penalización escala con el valor**: un error en una pregunta de 2 puntos resta el doble que en una de 1 (con la penalización 1/3, resta 2/3 de punto).

**Preguntas de respuesta corta (se corrigen solas).** Para preguntas cuya respuesta es una palabra, un número o una fórmula, escribe dentro de las llaves **solo respuestas con `=`** (ninguna `~`). El alumno ve un cuadro de una línea y el servidor compara lo que escribe con las respuestas aceptadas; puedes poner varias si hay más de una forma válida:

```
::C01::[valor=0,5] Escribe la fórmula del cloruro de sodio.{=NaCl}

::C02::¿Cómo se llama el compuesto NaCl?{=cloruro de sodio =cloruro sódico}

::C03::¿Cuántos gramos hay en 0,5 kg?{=500}
```

Cómo se compara (para que no haga falta prever cada variante):

- **Las tildes no cuentan**: «oxido de hierro(III)» vale por `óxido de hierro(III)` (tampoco la eñe: «estano» vale por `estaño`). **Las demás letras sí**: «sulfito» no vale por `sulfato`, porque es otro compuesto. Tampoco cuentan los espacios de más ni un punto final: «Cloruro sódico.» vale. Si la respuesta no tiene espacios, tampoco cuentan los del alumno: «Na Cl» vale por `NaCl`. Al alumno se le avisa en la pantalla inicial y debajo de cada cuadro.
- **Mayúsculas: solo cuentan en los símbolos de las fórmulas.** En los nombres dan igual, números romanos incluidos: «OXIDO DE HIERRO(iii)» vale por `óxido de hierro(III)`. En las fórmulas (`NaCl`, `CO2`, `H2O`, `Fe(OH)3`) **tienen que coincidir**: «nacl» es incorrecto y «Co» (cobalto) no vale por `CO`. La vista previa del panel te dice, en cada pregunta, dónde cuentan las mayúsculas.
- Da igual dejar o no un espacio junto a los paréntesis: «hierro (III)» vale por `hierro(III)`.
- Los subíndices cuentan como números normales (`H₂O` = `H2O`) y en los números da igual la coma o el punto (`0,5` = `0.5`).
- Para escribir `=`, `~`, `#`, `{` o `}` dentro de una respuesta aceptada, ponle delante una barra invertida (`v\=d/t`).

Cuentan como las de test (acierto, error o en blanco) y suman sus puntos, pero **un error no resta**: escribiendo al azar no se acierta.

**Varios cuadros en una pregunta.** Si pones varios bloques `{=…}` en una misma pregunta, el alumno ve un cuadro por bloque, en el sitio donde lo escribiste. El texto que va delante de cada bloque en su línea hace de etiqueta del cuadro. Sirve, por ejemplo, para dar una de las tres nomenclaturas y pedir las otras dos:

```
::F01::Fe2O3
Prefijos: {=trióxido de dihierro}
Stock: {=óxido de hierro(III)}

::F02::trióxido de azufre
Fórmula: {=SO3}
Stock: {=óxido de azufre(VI)}

::F03::HNO3
Tradicional: {=ácido nítrico}
```

- Cada pregunta puede tener los cuadros que necesite (hasta 10): la del ácido, solo uno.
- Se corrige **todo o nada**: la pregunta cuenta como bien solo si **todos** sus cuadros están bien. Si deja alguno vacío o lo falla, es un error (que no resta). Si no rellena ninguno, queda en blanco.
- Cada cuadro admite varias respuestas válidas (`{=monóxido de disodio =óxido de disodio}`) y se compara como cualquier respuesta corta (sin tildes; mayúsculas solo en los símbolos de las fórmulas).
- Varios cuadros pueden ir en la misma línea: `Fórmula: {=SO3} Stock: {=óxido de azufre(VI)}`.
- Al enviar, una pregunta con algún cuadro vacío sale en la lista de «En blanco», para que el alumno la revise.
- En «Revisar respuestas cortas» ves lo que escribió en cada cuadro y puedes marcar la pregunta entera como correcta o incorrecta. En la revisión del alumno, cada cuadro aparece con su etiqueta y, si falló, su respuesta correcta.
- Requiere `Code.gs` actualizado; si no lo está, el panel no publica el examen.

**Cambiar la corrección a mano.** Llegan ya corregidas, pero puedes cambiarlas: en «Mis exámenes», el botón **Revisar respuestas cortas** (o **Corregir abiertas**, si el examen también tiene abiertas) muestra cada pregunta de respuesta corta con lo que ha escrito cada alumno, marcado como «Correcta · automática» o «Incorrecta · automática». Si un alumno escribió algo válido que no habías previsto (por ejemplo «ClNa»), pulsa **✓ Correcta**, y si quieres dar por mala una que la máquina aceptó, **✗ Incorrecta**: la nota del alumno, sus aciertos y errores se recalculan al momento en la hoja y en la revisión. Volver a pulsar lo que diría la corrección automática la deja como automática. «Mostrar solo las incorrectas» te enseña solo las que conviene mirar. Las correcciones a mano se guardan en la columna oculta `cortas_manual` de la hoja.

En la revisión, el alumno ve lo que escribió y, si falló, la respuesta correcta. En ese cuadro tampoco se puede pegar texto. Requiere `Code.gs` actualizado; si no lo está, el panel lo detecta y **no publica** el examen.

**Respuestas numéricas con margen.** En un problema (concentraciones, masas, volúmenes…) cada alumno redondea a su manera. Para no tener que prever cada número, escribe la respuesta aceptada con un margen detrás:

```
::D01::[valor=0,5] Concentración de la disolución en g/L. Escribe solo el número.{=120 ±2%}

::D02::¿Cuántos mL del bote hay que tomar?{=4,15 ±0,05}
```

- `±2%` es un margen **relativo** (2 % del valor: de 117,6 a 122,4); `±0,05` es **absoluto** (de 4,10 a 4,20). También vale escribir `+-` en lugar de `±`.
- Vale cualquier número dentro del margen, con coma o con punto, **y con la unidad detrás o sin ella** («120», «119,5 g/L», «4,1 mL»). Lo que no empiece por un número no vale. El alumno no debe usar separador de miles («1.000» se lee como 1).
- Elige el margen para que los errores típicos queden fuera: por ejemplo, olvidar la riqueza del bote cambia el resultado un 5 %, así que con ±2 % no se da por buena.
- Sin margen (`{=120}`) todo sigue como antes: el número tiene que ser exactamente ese y sin unidad.
- Requiere `Code.gs` actualizado; si no lo está, el panel lo detecta y **no publica** el examen.

**Parte convalidable (por ejemplo, formulación).** Si algunos alumnos tienen convalidada una parte del examen, marca sus preguntas con `[convalidable=nombre]` al principio del enunciado (antes o después de `[valor=N]`):

```
::F01::[valor=0,1][convalidable=formulación] Escribe la fórmula del óxido de hierro(III).{=Fe2O3}
```

- En la portada del examen aparece la casilla **«Tengo convalidada la parte de formulación»**, con cuántas preguntas y puntos son. Quien la marca **no ve esas preguntas** y recibe **sus puntos enteros**; los demás las contestan con normalidad. El alumno que se equivoque puede cambiarlo al volver a entrar, antes de enviar.
- En la hoja de resultados aparece la columna **`convalidada`** («sí» en azul), junto a la nota, y en el CSV de notas la columna «Convalidada».
- **Compruébalo tú:** en «Mis exámenes», el botón de corrección tiene al final la pestaña **Convalidaciones**, con cada alumno y su estado. **Quitar convalidación** le deja esas preguntas en blanco (no las vio) y **Dar por convalidada** le da sus puntos (y se ignora lo que contestó en ellas). La nota se recalcula al momento, en la hoja y en la revisión.
- Las preguntas convalidadas no cuentan como aciertos, errores ni en blanco. En la revisión, el alumno las ve como «Convalidada», sin la solución.
- Solo puede haber **una** parte convalidable por examen (el mismo nombre en todas sus preguntas), solo con preguntas de test y de respuesta corta (no abiertas), y no puede serlo el examen entero.
- Si el examen tiene parte convalidable, **no barajes las preguntas** (para que quede junta, al final). Las opciones sí puedes barajarlas.
- Requiere `Code.gs` actualizado; si no lo está, el panel lo detecta y **no publica** el examen.

**Instrucciones para el alumno.** Al publicar puedes escribir unas instrucciones (hasta 2 000 caracteres, con saltos de línea) en «Instrucciones para el alumno». Se muestran en un recuadro al principio del examen, encima de la primera pregunta, cuando el alumno ya ha empezado. Son útiles con las preguntas de respuesta corta para explicar cómo escribir las respuestas (números romanos en mayúsculas, subíndices como números normales…). Se guardan en la columna `instrucciones` de la pestaña `Examenes`. Requiere `Code.gs` actualizado.

**Corregir las abiertas (en el panel, no en la hoja).** En «Mis exámenes», el examen con preguntas abiertas tiene el botón **Corregir abiertas** (en la misma pantalla están también las de respuesta corta, detrás de las abiertas). Se corrige **pregunta por pregunta**: arriba eliges la pregunta (con cuántas llevas corregidas), y debajo ves la respuesta de cada alumno en una caja grande y legible, con su grupo y, si los hubo, los intentos de pegar. Escribes los puntos (de 0 al máximo; acepta coma decimal) o pulsas **0**, **½** o **Máximo**, y se guardan solos al pulsar Intro o salir del campo; Intro salta al siguiente alumno. «Mostrar solo las sin corregir» te deja ver lo que falta.

La hoja de Google guarda los puntos, y la **nota final** de cada alumno (columna `nota`) se actualiza sola: test + puntos de las abiertas, sobre 10. Mientras no corrijas, `nota` es solo la del test y la columna `pendientes` sale en ámbar.

**Revisión para los alumnos (ver sus fallos).** Cuando todos hayan hecho el examen, pulsa **Publicar revisión** en «Mis exámenes». A partir de ese momento, cada alumno que abra **el mismo enlace del examen en el mismo dispositivo** desde el que lo envió ve su revisión: su nota, cada pregunta marcada como correcta, incorrecta o en blanco, su respuesta y la correcta, y en las abiertas lo que escribió y los puntos que le has puesto (o «pendiente de corregir»). Funciona aunque hayas cerrado el examen, y puedes volver a ocultarla con **Ocultar revisión**.

- Cada alumno solo ve **su propio** examen: el dispositivo guarda un identificador aleatorio de su envío y sin él no hay revisión.
- Si el examen sigue abierto, el panel te pide confirmación: quien aún no lo haya hecho podría ver las soluciones a través de un compañero.
- En un dispositivo compartido, el alumno elige su nombre de la lista de envíos hechos desde ese dispositivo.
- Si el alumno borra los datos del navegador o usa otro dispositivo, no puede ver la revisión.
- Solo vale para envíos hechos con esta versión: los exámenes entregados antes no guardaron el identificador en el dispositivo.
- Requiere `Code.gs` actualizado; si no lo está, el botón no aparece.

**Modo práctica (para estudiar).** Al publicar, marca **Modo práctica** para que un examen sirva de simulacro:

- El alumno puede hacerlo **todas las veces que quiera**. Al pulsar «Volver a intentarlo», empieza otra vez con el examen vacío y su nombre ya escrito.
- **Al enviarlo ve al momento su resultado**: la nota, qué tiene bien y mal en cada pregunta y las respuestas correctas, sin esperar a que publiques la revisión.
- **No hay vigilancia** (ni salidas, ni pantalla completa) y **los intentos no se guardan en la hoja**: no aparecen en la pestaña de resultados, ni en el CSV, ni en la corrección.
- Las preguntas abiertas no se corrigen en la práctica: el alumno ve lo que escribió y cuentan como 0 en esa nota.
- En «Mis exámenes» lleva la etiqueta **Práctica**. El código de acceso, el tiempo límite y cerrar el examen funcionan igual que siempre.
- **Convertir un examen ya hecho en práctica:** en «Mis exámenes», pulsa **Convertir en práctica**. El mismo enlace pasa a funcionar como práctica; las notas que ya están en la hoja no cambian y, mientras sea práctica, no se guarda ningún envío nuevo (hazlo cuando todos hayan hecho el examen). Si tienes publicada la revisión, quien hizo el examen desde su dispositivo seguirá viendo su revisión en lugar de la práctica: pulsa también «Ocultar revisión» si quieres que practiquen. **Volver a examen** lo deja como estaba, con su vigilancia. También puedes cambiar a mano la columna `practica` de la pestaña `Examenes`.
- Si prefieres mantener el examen real tal cual (con su revisión y su enlace), pulsa **Exportar preguntas (GIFT)** y publica ese GIFT como examen nuevo en modo práctica.
- Requiere `Code.gs` actualizado; si no lo está, el panel no lo publica.

**Exportar las preguntas (GIFT).** El botón **Exportar preguntas (GIFT)** de cada examen descarga sus preguntas, con las soluciones, en un archivo `.gift`: sirve para reutilizar un examen, retocarlo y publicarlo de nuevo, o recuperar el GIFT si lo has perdido. Al publicar, el panel guarda el **GIFT original tal como lo subiste** (con tus comentarios y tu formato) en la columna oculta `gift` de la pestaña `Examenes`, y eso es lo que se descarga. En los exámenes publicados antes de esta versión (o si el GIFT no cabía en una celda), se genera a partir de las preguntas guardadas: mismas preguntas, valores y soluciones, pero sin tus comentarios. Las instrucciones para el alumno van al principio como comentario (para reutilizarlas, cópialas al campo de instrucciones). Las imágenes no van dentro: el GIFT solo las cita por su nombre, así que al publicarlo de nuevo tendrás que volver a subirlas. El archivo lleva las soluciones: guárdalo fuera del repositorio. Requiere `Code.gs` actualizado.

**Exportar las notas.** El botón **Exportar notas (CSV)** de cada examen descarga una tabla limpia (apellidos, nombre, grupo, nota final, aciertos, errores, en blanco, salidas, segundos fuera, desconexiones, segundos sin conexión, intentos de pegar), ordenada por apellidos y lista para abrir en Excel en español (separador `;`, decimales con coma).

**Qué ve el alumno.** Solo la parte del test: «Parte tipo test: X sobre Y puntos» y el aviso de que las abiertas las corrige el profesor. Si quitas «Mostrar la nota al alumno», no ve nada.

Requiere `Code.gs` actualizado; si no lo está, el panel lo detecta y **no publica** el examen.

### Generar el GIFT con una IA

Si vas a pedirle el GIFT a una IA (ChatGPT, Claude, etc.), **pégale este bloque** antes de tus apuntes y añade al final los puntos que quieres. Así el resultado funciona a la primera:

````text
Genera preguntas en formato GIFT para mi aplicación de exámenes. Devuelve SOLO el texto GIFT dentro de un único bloque de código, sin explicaciones.

REGLAS DEL FORMATO (obligatorias):
1. Una pregunta por bloque; separa los bloques con UNA línea en blanco.
2. Estructura de una pregunta de TEST:
   ::P01::[valor=N] Enunciado de la pregunta{
   =Opción correcta
   ~Opción incorrecta
   ~Opción incorrecta
   ~Opción incorrecta
   }
3. Cada pregunta de test tiene EXACTAMENTE UNA opción correcta (=) y entre 2 y 6 opciones (preferible 4). Nada de varias correctas, verdadero/falso con %pesos%, huecos ni emparejamientos.
4. Varía la posición de la opción correcta (no la pongas siempre la primera). La opción correcta NO debe ser la más larga ni la más detallada: escribe las incorrectas con una longitud parecida (o más largas), con detalles creíbles pero falsos, para que la longitud no delate la respuesta.
5. No pongas feedback (#...), ni pesos (%50%), ni categorías ($CATEGORY), ni formato [html]/[markdown].
6. PUNTOS: la marca [valor=N] va al PRINCIPIO del enunciado, justo después del título ::Pxx::. N es un número mayor que 0 (usa punto o coma decimal: 1, 2, 0.5). Si una pregunta vale 1 punto puedes omitirla.
7. PREGUNTAS ABIERTAS (respuesta escrita por el alumno): llaves VACÍAS, sin opciones. Ejemplo:
   ::A01::[valor=3] Explica con tus palabras qué es el método científico.{}
   PREGUNTAS DE RESPUESTA CORTA (una palabra, número o fórmula que se corrige sola): dentro de las llaves SOLO respuestas aceptadas con =, sin ninguna ~, en una línea. Pon todas las formas válidas. Escribe las palabras en minúsculas y con su ortografía correcta, y las fórmulas con sus mayúsculas exactas (el programa no tiene en cuenta las tildes ni las mayúsculas de los nombres). Ejemplos:
   ::C01::Escribe la fórmula del cloruro de sodio.{=NaCl}
   ::C02::¿Cómo se llama el compuesto NaCl?{=cloruro de sodio =cloruro sódico}
   Si una pregunta pide VARIAS respuestas cortas (por ejemplo, dos nomenclaturas), pon un bloque {=…} por cuadro, cada uno en su línea detrás de su etiqueta. La pregunta solo cuenta como bien si todos los cuadros lo están:
   ::F01::Fe2O3
   Prefijos: {=trióxido de dihierro}
   Stock: {=óxido de hierro(III)}
   RESPUESTAS NUMÉRICAS (problemas): una sola respuesta aceptada con margen detrás, relativo (±2%) o absoluto (±0,05), y pide en el enunciado «Escribe solo el número». Ejemplo:
   ::D01::[valor=0.5] Disolvemos 30 g de azúcar hasta 250 mL de disolución. ¿Concentración en g/L? Escribe solo el número.{=120 ±2%}
   PARTE CONVALIDABLE (solo si te lo pido): marca sus preguntas con [convalidable=nombre] justo después de [valor=N], con el mismo nombre en todas. Ejemplo:
   ::F01::[valor=0.1][convalidable=formulación] Escribe la fórmula del óxido de hierro(III).{=Fe2O3}
8. Para escribir los caracteres : = ~ # { } dentro de un texto, ponles delante una barra invertida (\= \{ \}...). Evita fórmulas en LaTeX; escribe las fórmulas con texto simple (v = d/t, 3x^2).
9. Imágenes (solo en el enunciado, no en opciones): ![descripción](nombre.png) con un nombre de archivo simple, sin carpetas ni http. Solo si yo te indico qué imágenes hay.
10. Títulos ::P01::, ::P02::... correlativos (A01, A02... para abiertas; C01, C02... para respuesta corta). Los comentarios empiezan por //.

PUNTUACIÓN QUE QUIERO:
[ESCRÍBELO AQUÍ, por ejemplo:]
- 20 preguntas de test de 0.5 puntos cada una.
- 2 preguntas abiertas de 2 puntos cada una.
````

**Cómo indicarle los puntos a la IA** (lo escribes tú al final del bloque, en lenguaje normal; la IA lo traduce a `[valor=N]`):

| Lo que quieres | Lo que le escribes |
|---|---|
| Todas iguales | «20 preguntas de test, todas de 0,5 puntos.» |
| Test normal y alguna más importante | «15 preguntas de test de 1 punto, y las preguntas 14 y 15 de 2 puntos.» |
| Test + abiertas | «18 de test de 0,5 puntos y 2 abiertas de 3 puntos cada una.» |
| Por dificultad | «Fáciles (1 punto), medias (1,5) y difíciles (2); pon 5 de cada.» |
| Una abierta concreta | «La última pregunta es abierta y vale 4 puntos.» |
| Respuesta corta | «Añade 5 preguntas de respuesta corta de formulación (fórmula ↔ nombre), de 0,5 puntos.» |

No hace falta que sumen 10: la nota se proporciona sobre 10 con el total. Revisa siempre la **vista previa del panel** (respuesta correcta marcada ✓, valor de cada pregunta y reparto total) antes de publicar: la IA puede equivocarse, y la corrección del test depende de que la opción marcada con `=` sea la buena. Fíjate también en que la IA no haya puesto casi siempre la opción correcta como la más larga.

### Imágenes en las preguntas

En el enunciado puedes poner una imagen con esta marca, que lleva **solo el nombre del archivo**:

```
::P05::Observa la gráfica. ¿Qué movimiento representa?
![gráfica velocidad-tiempo](grafica1.png){
=Movimiento uniformemente acelerado
~Movimiento uniforme
~Reposo
}
```

Al cargar el GIFT en el panel, aparece **«Imágenes de las preguntas»** con las que cita el examen. Selecciona los archivos de tu ordenador (todos a la vez; no distingue mayúsculas) y el panel:

- **Los reduce** a un máximo de 1000 píxeles y los comprime: una foto en PNG de varios MB queda en unos 150 KB (como JPEG); un esquema o dibujo de líneas se conserva como PNG si es pequeño.
- Te los **enseña en la vista previa** y no deja publicar mientras falte alguno.
- Los guarda en la pestaña `Imagenes` de **tu hoja de Google** (no en GitHub, así que no se ven antes del examen) y los entrega al alumno con el examen, solo después de acertar el código de acceso.

Límites: hasta **12 imágenes por examen** y unos **1,5 MB** en total. Solo van en el **enunciado** (no en las opciones). El texto entre corchetes es la descripción alternativa (para lectores de pantalla). No valen direcciones de internet ni rutas con carpetas.

Requiere `Code.gs` actualizado: si no lo está, el panel lo detecta y **no publica** (para no dejar un examen sin imágenes). No borres la pestaña `Imagenes`.

### Publicar

1. Abre `admin.html` e introduce tu token (se guarda solo en tu navegador).
2. En **Crear examen**, sube el archivo (o pega el texto). Verás una vista previa con la respuesta correcta marcada; revisa que sea la que esperas. Si hay errores, la pantalla te dice en qué pregunta.
3. Rellena los ajustes: título, grupo, tiempo límite, código de acceso (opcional), **penalización por cada error**, barajar preguntas y opciones, mostrar la nota al terminar, permitir nota negativa, **vigilar salidas** (con cuántas se permiten) y, opcionalmente, **exigir pantalla completa en ordenadores**.
4. **Publicar examen.** Obtendrás un **enlace** y un **código QR** para dárselos a los alumnos.

### Examen vigilado (control de salidas)

Al publicar, la casilla **«Vigilar salidas»** viene marcada, con **3 salidas permitidas** (puedes cambiar el número, de 0 a 20; solo lo ves tú). Con ella:

- Cada vez que el alumno **cambia de pestaña, de ventana o de aplicación**, usa otra web en pantalla dividida o bloquea el dispositivo, se **cuenta una salida** y se mide el **tiempo que está fuera**.
- **El alumno no ve cuántas salidas se permiten.** Solo se le dice que salir está prohibido, que queda registrado y que, si continúa, el examen se enviará automáticamente. Al volver tras una salida dentro del límite, ve un **aviso en rojo** de que está prohibido y de que el examen se enviará si continúa.
- **Mientras el alumno está «fuera», el examen se oculta.** Si está en pantalla dividida, con la ventana reducida, en otra pestaña o app, no puede ver ni contestar las preguntas: aparece «Examen oculto. Vuelve a la ventana completa del examen para continuar». El tiempo fuera se sigue registrando.
- Mientras no supere el límite, el alumno puede seguir con el examen: una notificación o un toque accidental no le cuesta la nota.
- Al **superar las salidas permitidas** (con 3, a la cuarta), el examen **se envía automáticamente** tal como esté.
- Las salidas y el tiempo fuera **quedan siempre registrados**, tanto si el alumno envía el examen él mismo como si se envía solo o se acaba el tiempo.
- La pantalla inicial explica la norma al alumno. Durante el examen se desactivan **copiar, cortar, pegar, el menú contextual y seleccionar texto** (frena la copia casual; no es infalible).
- En la hoja de resultados aparecen cinco columnas más: `salidas`, `segundos_fuera`, `tipo_envio` (`manual`, `tiempo` o `salida`), `envio_id` y `motivos_salida`.

La nota se calcula con normalidad: la app **no pone un 0 automático**. Las columnas `salidas` y `segundos_fuera` son una señal para que decidas tú.

**Límites que conviene conocer.** Una web puede detectar que el alumno se va, pero no impedirlo, ni ver otros dispositivos (por ejemplo, un móvil al lado). El registro lo envía el navegador del alumno. Si el alumno sale y no vuelve a abrir el examen mientras le quedan salidas, no se genera ninguna fila hasta que lo envíe. Para un bloqueo real en iPad, usa el **Acceso guiado** del propio iPad (*Ajustes → Accesibilidad → Acceso guiado*; se inicia con triple clic en el botón lateral) o el modo de app única que el centro puede activar desde su sistema de gestión de dispositivos. Se complementa con esta vigilancia.

**Cómo se detecta la salida.** Se combinan varias señales, porque ninguna basta por sí sola. Cada una tiene un **margen**: solo cuenta como salida si se mantiene más de ese tiempo, para no penalizar los gestos naturales de la tableta (centro de control, barra de aplicaciones, giros...).

| Señal | Qué detecta | Margen |
|---|---|---|
| Página oculta | Otra pestaña, otra app (cuando cubre todo), pantalla bloqueada | al instante en ordenadores; 2 s en tabletas (al desplazarse con el dedo desde el borde, el iPad activa a veces el Dock o la multitarea un instante) |
| Ventana reducida | Solo en tabletas: pantalla dividida, Slide Over o Stage Manager que reducen la ventana. No cuenta mientras el alumno escribe en un cuadro de texto (el teclado en pantalla también encoge la ventana) ni al ampliar con dos dedos | 1,5 s |
| Ventana sin foco | Solo en ordenadores: hacer clic en otra ventana o app. En tabletas no se usa, porque Safari en iPad la activa al ocultar el teclado y en otros gestos sin que el alumno salga | 2 s |
| Salir de la pantalla completa | **Solo en ordenadores (Mac, Windows, Linux, Chromebook) y solo si marcas «Exigir pantalla completa en ordenadores»** al publicar (opcional, desactivada por defecto). Se pide pantalla completa al empezar; si el alumno sale de ella, el examen se oculta y un clic en cualquier parte (o el botón) la restaura. En iPad, tabletas y móviles no se pide nunca | 1,5 s |

La pantalla completa es opcional y **solo se exige en ordenadores**, donde funciona bien. En tabletas y móviles su comportamiento depende demasiado del navegador, así que allí no se pide aunque marques la opción: la vigilancia sigue funcionando con las demás señales (la pantalla dividida se detecta por el tamaño de la ventana). Un mismo examen puede hacerse a la vez en ordenadores, con pantalla completa, y en iPad, sin ella.

**Al empezar no se penaliza nada.** Mientras el examen no esté bien colocado (por ejemplo, empezado en pantalla dividida, o sin pantalla completa si la has exigido), el alumno ve un aviso («Pon el examen a toda la pantalla… Esto todavía no cuenta como salida») y la vigilancia no empieza hasta que lleva 1,5 s seguidos en buen estado. Si el navegador no permite la pantalla completa, no se exige. Tras pedirla, se esperan 2,5 s a que el navegador termine de cambiar de tamaño.

Cada salida guarda en la hoja **qué señal la provocó** (`motivos_salida`, por ejemplo `reduced,hidden`): si en algún dispositivo salen salidas que no esperas, esa columna dice la causa. Los motivos posibles son `hidden` (página oculta), `reduced` (ventana reducida), `blurred` y `noFocus` (otra ventana activa, solo en ordenadores) y `fullscreenLost` (salió de la pantalla completa).

**Cambio de escritorio a medias (solo ordenadores).** En el Mac, el gesto de cambio de escritorio hecho a medias deja ver otra pantalla sin que el examen pierda el foco ni se oculte. Lo único que lo delata es que la ventana se aparta de debajo del ratón: el ratón deja de estar sobre el examen sin haberse movido hasta un borde. Si eso dura más de 1,5 s, **solo se registra para ti**: al alumno no se le avisa, no se le tapa el examen y no le cuenta para el límite de salidas. En la hoja aparece en dos columnas junto a las salidas, en rojo cuando son mayores que 0: `cambios_escritorio` (cuántas veces) y `segundos_escritorio` (tiempo total con otra pantalla a la vista), y como `mouseOut` en `motivos_salida`. Si el ratón sale por un borde (barra de menús, Dock o fuera de la ventana) más de 1,5 s, solo se apunta `mouseEdge` en `motivos_salida`. En los motivos se apuntan como mucho 5 de estos por alumno. Si a la vez el examen pierde el foco o se oculta, no se apunta, porque eso ya cuenta como salida. Para que las columnas aparezcan hay que publicar la nueva versión del Apps Script.

**Ventana encima del examen (solo tabletas).** En el iPad, una app en una ventana flotante (Slide Over o Stage Manager) tapa el examen sin ocultarlo ni cambiar su tamaño. Lo único que la delata es que Safari deja de ser la ventana activa mientras está encima. Si eso dura más de 2 s sin que el alumno toque el examen, **solo se registra para ti**, igual que el cambio de escritorio: sin aviso al alumno y sin contar para el límite de salidas. En la hoja aparece en `ventanas_encima` y `segundos_ventana_encima`, junto a las anteriores y en rojo cuando son mayores que 0, y como `overlay` en `motivos_salida`. No cuenta si justo antes se ha abierto o cerrado el teclado (que también quita el foco un instante) ni si la página se oculta (eso ya es una salida). Termina cuando Safari recupera el foco o el alumno toca el examen. Requiere la nueva versión del Apps Script.

**Pantalla dividida en iPad que no dan el tamaño real de la pantalla.** Algunos iPad (iPadOS con ventanas) dan al navegador como tamaño de pantalla el de la propia ventana, así que la pantalla dividida parecía ocupar toda la pantalla y no se detectaba. Ahora se compara también con la ventana más grande vista durante el examen: si pasa a ocupar menos del 75 % de ella, cuenta como ventana reducida. Si el alumno empieza el examen ya en pantalla dividida, en esos iPad no se puede saber.

**Pérdida de la conexión a internet.** Cuando el dispositivo del alumno se queda sin red durante el examen (wifi caído o apagado, modo avión), **solo se registra**: no cuenta como salida, no oculta el examen y no lo envía. La hoja guarda cuántas veces la perdió (`desconexiones`) y cuánto tiempo estuvo sin ella (`segundos_sin_conexion`), las dos en ámbar cuando son mayores que 0, y añade `offline` a `motivos_salida` por cada corte (por ejemplo `hidden,offline`). Se registra en todos los exámenes, vigilados o no. Las respuestas se siguen guardando en el dispositivo; si el alumno intenta enviar sin conexión, se le avisa y puede reintentar cuando vuelva. Se detecta que el dispositivo se queda sin red; un wifi conectado pero sin salida a internet puede no detectarse.

Durante un examen vigilado se pide al navegador que **mantenga la pantalla encendida**, para que el iPad no se bloquee solo mientras el alumno lee o piensa (eso contaba como salida). Funciona en iPadOS 16.4 o posterior; en versiones anteriores, sube el bloqueo automático en *Ajustes → Pantalla y brillo*.

Si el iPad congela la página mientras el alumno está en otra app, la salida se cuenta igualmente al volver, con el tiempo real que estuvo fuera.

El ratón fuera de la página **no** cuenta: se disparaba solo con acercarlo a la barra de pestañas o a la barra de desplazamiento, o con dejarlo en el borde. Si el alumno hace clic en otra ventana, lo detecta la señal de foco.

**Lo que ninguna web puede detectar.** En un iPad, una app flotante (Slide Over) que se coloca encima **sin reducir ni quitar el foco a la ventana** no emite ninguna señal. Lo mismo ocurre con un móvil o un papel junto al ordenador. La medida eficaz para esos casos es el **Acceso guiado** del iPad (o el modo de app única del centro), que además impide abrir apps flotantes. Si en algún dispositivo una salida no se cuenta, abre `diagnostico.html` en él: muestra en directo qué señales emite.

### Ver resultados

En **Mis exámenes** pulsa **Ver hoja de Google** para abrir la hoja de ese examen (una pestaña **con el título del examen**; si repites título, se añade « (2)»; puedes renombrarla sin problema), con una fila por envío:

Las hojas **nuevas** están pensadas para leerse de un vistazo: cabecera azul, filas alternas, y esta primera parte visible:

`apellidos | nombre | grupo | nota | (pendientes) | aciertos | errores | blancos | salidas | segundos_fuera | pegados | duracion_min | fecha | posible_duplicado`

La **nota** sale en verde (aprobado) o rojo; `pendientes` (preguntas abiertas sin corregir), `salidas`, `segundos_fuera`, `desconexiones`, `segundos_sin_conexion` y `pegados` se marcan en color cuando son mayores que 0. Después van **ocultas** las columnas técnicas (puntos del test, respuestas y puntos de las abiertas, `tipo_envio`, `envio_id`, `motivos_salida`, `respuestas_json`); si las necesitas, selecciona las columnas vecinas y elige «Mostrar columnas». Las hojas de exámenes anteriores conservan su formato.

El alumno rellena **Nombre** y **Apellidos** en casillas separadas, y la hoja se mantiene **ordenada alfabéticamente por apellidos** (y, si coinciden, por nombre; sin distinguir tildes ni mayúsculas) cada vez que llega un envío.

Las hojas de exámenes publicados **antes** de este cambio conservan su formato (una sola columna `nombre`): ahí los nuevos envíos se guardan como «Apellidos, Nombre» y no se reordenan. Para tener la hoja ordenada, publica el examen de nuevo.

`envio_id` es un identificador interno que evita filas repetidas si un envío se reintenta. `posible_duplicado` es `TRUE` si ya había un envío con los mismos apellidos, nombre y grupo (sin tener en cuenta tildes, mayúsculas ni espacios). No se bloquea el envío; solo se marca para que lo revises.

### La pestaña «Examenes»

Es el registro de tus exámenes, con el mismo diseño que las hojas de resultados: título en negrita, **activo** en verde (abierto) o rojo (cerrado), fecha de creación legible. Las columnas técnicas (las preguntas con sus soluciones y el identificador de la hoja de resultados) quedan **ocultas**; no las borres. Al publicar un examen nuevo, la pestaña se pone bonita aunque ya la tuvieras. Puedes abrir o cerrar un examen desde el panel o cambiando `activo` a mano.

### Cerrar un examen

Desde **Mis exámenes → Cerrar examen**. Los alumnos que abran el enlace verán «Examen cerrado». Puedes volver a abrirlo cuando quieras.

### Cómo se calcula la nota

Cada acierto suma los puntos de la pregunta (**1** si no pone `[valor=N]`), cada pregunta en blanco **0** y cada error **resta una fracción de esos puntos**. Las preguntas abiertas las puntúas tú en la hoja (ver arriba) y las de respuesta corta suman sus puntos si aciertan y nunca restan; el resto de esta sección explica el test con preguntas de 1 punto.

Al publicar el examen eliges la **penalización por cada error**, siempre como fracción:

| Opción | Cada error resta |
|---|---|
| **Automática** (por defecto) | 1/(opciones − 1): 1/3 con 4 opciones, 1/2 con 3, 1/4 con 5 |
| Sin penalización | 0 |
| 1/2, 1/3, 1/4, 1/5 | esa fracción de punto, sea cual sea el número de opciones |
| Otra fracción | cualquier `a/b` entre 0 y 1 (por ejemplo 2/5) |

El panel muestra un ejemplo con la fracción elegida (12 aciertos, 5 errores y 3 en blanco de 20 preguntas), y el alumno ve en la pantalla inicial lo que resta cada error. La fracción se guarda reducida (2/6 pasa a 1/3).

`nota = (aciertos − errores × penalización) / nº de preguntas × 10` (con valores distintos: `(Σ puntos acertados − Σ puntos de errores × penalización) / Σ puntos de todas las preguntas × 10`), redondeada a 2 decimales. Por defecto la nota mínima es 0 (se puede permitir negativa al publicar el examen).

Los exámenes ya publicados antes de poder elegir la penalización siguen con la automática. Si publicas con un `Code.gs` antiguo, el panel te avisa de que la penalización elegida no se aplicará.

---

## Actualizar a una versión nueva

Cuando haya mejoras en el repositorio original:

1. **Tu copia en GitHub:** en tu repositorio pulsa **Sync fork → Update branch**. Tu `js/config.js` (con tu URL) se conserva mientras no haya cambios del original en ese archivo; compruébalo después. Si aparece un conflicto, **conserva tu propia URL**, nunca elijas «descartar cambios».
2. **Tu script de Google:** el backend vive en Google, no en GitHub, así que hay que copiarlo a mano. Abre `apps-script/Code.gs`, copia todo (botón **Copy raw file**), pégalo en el editor de Apps Script y guarda.
3. Publica una **versión nueva sin cambiar la URL**: **Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar**. Si eliges «Nueva implementación» obtendrás una URL distinta y tendrás que actualizar `js/config.js`.
4. **Actualiza el diseño de las hojas (recomendado):** en el editor de Apps Script elige la función `setup` en el desplegable y pulsa **Ejecutar**. Añade a las hojas de resultados ya existentes las columnas nuevas, las coloca en su sitio (por ejemplo, `desconexiones` junto a `salidas`) y les da el mismo formato que a las demás: cabecera azul, colores y columnas técnicas ocultas. No se pierde ningún dato, y las columnas que hayas añadido tú quedan al final. Si no lo haces, cada hoja se arregla sola la próxima vez que un alumno envíe ese examen.
5. **Publica de nuevo** los exámenes que quieras que usen las novedades (los ya publicados conservan su comportamiento y su hoja).

Si el panel te dice que el script no está actualizado (al publicar con penalización elegida, pantalla completa o imágenes), es que falta el paso 2 o el 3.

Si tu copia (fork) se creó cuando la rama por defecto no era `main`, en tu repositorio puedes renombrar esa rama a `main` (**Settings → Branches → Rename branch**) y comprobar en **Settings → Pages** que sigue publicando desde ella.

## Si los alumnos usan los iPad o los ordenadores del centro

Los filtros web de algunos centros bloquean dominios. La aplicación necesita llegar a:

- `TU_USUARIO.github.io` (la página del examen),
- `script.google.com` y `script.googleusercontent.com` (el servidor que corrige y guarda).

Si el examen no carga en los dispositivos del centro pero sí con datos móviles, pide al responsable informático que permita esos dominios. Los alumnos no inician sesión en nada.

## Qué datos se guardan

Solo **nombre, apellidos, grupo, respuestas, nota y los datos de las salidas del examen** (cuántas y cuánto tiempo, si vigilas) y de las pérdidas de conexión de cada alumno, en tu hoja de Google. Las imágenes de los enunciados también se guardan ahí. No se piden correos ni otros datos y los alumnos no tienen cuenta. No compartas la hoja con nadie: contiene las soluciones y los nombres. Recuerda informar a las familias de este tratamiento según la política de tu centro.

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| El alumno ve «La aplicación no está configurada» | Falta la URL en `js/config.js` (Parte 3). |
| El panel dice «Token de administración incorrecto» | El token escrito no coincide con `ADMIN_TOKEN`. Revisa mayúsculas y espacios. |
| `token_not_configured` | No has creado la propiedad `ADMIN_TOKEN` (Parte 2, paso 4). |
| «No hay conexión con el servidor» pero hay internet | La implementación no tiene acceso *Cualquier usuario*, o la URL de `config.js` no es la de `/exec`. Revisa el paso 6 de la Parte 2. |
| Cambié `Code.gs` pero nada cambia | Falta publicar una **Nueva versión** de la implementación (ver arriba). |
| «El examen es demasiado grande» | Supera el límite de una celda de Google Sheets (~49 000 caracteres). Divídelo en dos exámenes. |
| GitHub Pages da error 404 | Espera unos minutos tras activarlo y comprueba rama y carpeta en *Settings → Pages*. |
| «El script de Google no está actualizado…» al publicar | Tu `Code.gs` es anterior a la web. Cópialo de nuevo y publica una **Nueva versión** (ver «Actualizar a una versión nueva»). |
| Al publicar con imágenes: «Falta la imagen…» o el botón está deshabilitado | Sube todas las imágenes que cita el GIFT, con el mismo nombre de archivo. Las citas deben llevar solo el nombre (sin carpetas ni `http`). |
| El examen no carga en los iPad del centro pero sí en el móvil con datos | El filtro del centro bloquea algún dominio: ver «Si los alumnos usan los iPad o los ordenadores del centro». |
| Los alumnos ven «Pon el examen a toda la pantalla» y no avanza | Tienen la ventana reducida o en pantalla dividida: que la amplíen. Si ocurre a pantalla completa, abre `diagnostico.html` en ese dispositivo y mira la «Proporción». |
| Una salida que no esperabas en la hoja | Mira la columna `motivos_salida` de esa fila: dice qué señal la provocó. |
| Los resultados no salen ordenados por apellidos | Es una hoja de un examen publicado antes del cambio: publica el examen de nuevo. |

## Para desarrolladores

No hay paso de compilación: HTML, CSS y JavaScript con módulos ES nativos.

```
index.html, admin.html     Páginas del alumno y del profesor
diagnostico.html           Muestra en directo las señales de vigilancia de un dispositivo
css/styles.css             Estilos (claro y oscuro)
js/config.js               URL del Apps Script
js/api.js                  Llamadas al Apps Script (POST como text/plain, sin preflight CORS)
js/student.js, admin.js    Lógica de cada página
js/correction.js           Pantalla de corrección de abiertas y de respuesta corta, y exportación CSV
js/gift.js                 Parser GIFT: [valor=N], respuesta corta {=a =b} y abiertas {} (función pura)
js/grading.js              Corrección ponderada y penalización fraccionaria (pura; replicada en Code.gs)
js/short.js                Comparación de respuestas cortas (pura; replicada en Code.gs)
js/images.js               Citas de imágenes ![alt](archivo.png) y límites (puro; réplica parcial en Code.gs)
js/image-encode.js         Reduce y codifica las imágenes en el navegador (canvas)
js/rich.js                 Pinta un enunciado con imágenes sin insertar HTML
js/watch.js                Máquina de estados de la vigilancia (pura; márgenes por señal)
js/presence.js             ¿Ventana reducida? (pura)
js/util.js, dom.js         Utilidades
js/vendor/qrcode.js        qrcode-generator 1.4.4 (MIT), incluido para no depender de un CDN
apps-script/Code.gs        Backend (se copia a mano al editor de Apps Script)
tests/                     Tests con Node (incluye una hoja de Google simulada)
```

Tests (requieren Node 20 o superior; no hay dependencias que instalar):

```
node --test
```

Guía de validación con Google real: [docs/PRUEBA_FINAL.md](docs/PRUEBA_FINAL.md).

`tests/codegs.test.js` carga `Code.gs` con una hoja de cálculo simulada (`tests/fake-gas.js`, que imita también conversiones automáticas de Sheets como `1/3` → fecha) y comprueba que su corrección (incluida la de respuesta corta de `js/short.js`) coincide con `js/grading.js` con miles de casos aleatorios. **Si cambias la lógica de corrección o el formato de las citas de imágenes en uno de los dos archivos, cámbiala también en el otro.**
