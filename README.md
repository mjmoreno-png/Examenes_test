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

### Puntos por pregunta y preguntas abiertas

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

**Corregir las abiertas (en el panel, no en la hoja).** En «Mis exámenes», el examen con preguntas abiertas tiene el botón **Corregir abiertas**. Se corrige **pregunta por pregunta**: arriba eliges la pregunta (con cuántas llevas corregidas), y debajo ves la respuesta de cada alumno en una caja grande y legible, con su grupo y, si los hubo, los intentos de pegar. Escribes los puntos (de 0 al máximo; acepta coma decimal) o pulsas **0**, **½** o **Máximo**, y se guardan solos al pulsar Intro o salir del campo; Intro salta al siguiente alumno. «Mostrar solo las sin corregir» te deja ver lo que falta.

La hoja de Google guarda los puntos, y la **nota final** de cada alumno (columna `nota`) se actualiza sola: test + puntos de las abiertas, sobre 10. Mientras no corrijas, `nota` es solo la del test y la columna `pendientes` sale en ámbar.

**Revisión para los alumnos (ver sus fallos).** Cuando todos hayan hecho el examen, pulsa **Publicar revisión** en «Mis exámenes». A partir de ese momento, cada alumno que abra **el mismo enlace del examen en el mismo dispositivo** desde el que lo envió ve su revisión: su nota, cada pregunta marcada como correcta, incorrecta o en blanco, su respuesta y la correcta, y en las abiertas lo que escribió y los puntos que le has puesto (o «pendiente de corregir»). Funciona aunque hayas cerrado el examen, y puedes volver a ocultarla con **Ocultar revisión**.

- Cada alumno solo ve **su propio** examen: el dispositivo guarda un identificador aleatorio de su envío y sin él no hay revisión.
- Si el examen sigue abierto, el panel te pide confirmación: quien aún no lo haya hecho podría ver las soluciones a través de un compañero.
- En un dispositivo compartido, el alumno elige su nombre de la lista de envíos hechos desde ese dispositivo.
- Si el alumno borra los datos del navegador o usa otro dispositivo, no puede ver la revisión.
- Solo vale para envíos hechos con esta versión: los exámenes entregados antes no guardaron el identificador en el dispositivo.
- Requiere `Code.gs` actualizado; si no lo está, el botón no aparece.

**Exportar las notas.** El botón **Exportar notas (CSV)** de cada examen descarga una tabla limpia (apellidos, nombre, grupo, nota final, aciertos, errores, en blanco, salidas, segundos fuera, intentos de pegar), ordenada por apellidos y lista para abrir en Excel en español (separador `;`, decimales con coma).

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
4. Varía la posición de la opción correcta (no la pongas siempre la primera).
5. No pongas feedback (#...), ni pesos (%50%), ni categorías ($CATEGORY), ni formato [html]/[markdown].
6. PUNTOS: la marca [valor=N] va al PRINCIPIO del enunciado, justo después del título ::Pxx::. N es un número mayor que 0 (usa punto o coma decimal: 1, 2, 0.5). Si una pregunta vale 1 punto puedes omitirla.
7. PREGUNTAS ABIERTAS (respuesta escrita por el alumno): llaves VACÍAS, sin opciones. Ejemplo:
   ::A01::[valor=3] Explica con tus palabras qué es el método científico.{}
8. Para escribir los caracteres : = ~ # { } dentro de un texto, ponles delante una barra invertida (\= \{ \}...). Evita fórmulas en LaTeX; escribe las fórmulas con texto simple (v = d/t, 3x^2).
9. Imágenes (solo en el enunciado, no en opciones): ![descripción](nombre.png) con un nombre de archivo simple, sin carpetas ni http. Solo si yo te indico qué imágenes hay.
10. Títulos ::P01::, ::P02::... correlativos (A01, A02... para abiertas). Los comentarios empiezan por //.

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

No hace falta que sumen 10: la nota se proporciona sobre 10 con el total. Revisa siempre la **vista previa del panel** (respuesta correcta marcada ✓, valor de cada pregunta y reparto total) antes de publicar: la IA puede equivocarse, y la corrección del test depende de que la opción marcada con `=` sea la buena.

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
3. Rellena los ajustes: título, grupo, tiempo límite, código de acceso (opcional), **penalización por cada error**, barajar preguntas y opciones, mostrar la nota al terminar, permitir nota negativa, **vigilar salidas** (con cuántas se permiten) y, opcionalmente, **exigir pantalla completa**.
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
| Salir de la pantalla completa | **Solo si marcas «Exigir pantalla completa»** al publicar (opcional, desactivada por defecto). Se pide pantalla completa al empezar; si el alumno sale de ella, el examen se oculta y un **toque** en cualquier parte (o el botón) la restaura | 5 s en tabletas, 1,5 s en ordenadores |

La pantalla completa es opcional porque su comportamiento depende mucho del navegador y del dispositivo. Sin ella, la vigilancia sigue funcionando con las demás señales: la pantalla dividida se detecta por el tamaño de la ventana.

**Al empezar no se penaliza nada.** Mientras el examen no esté bien colocado (por ejemplo, empezado en pantalla dividida, o sin pantalla completa si la has exigido), el alumno ve un aviso («Pon el examen a toda la pantalla… Esto todavía no cuenta como salida») y la vigilancia no empieza hasta que lleva 1,5 s seguidos en buen estado. Si el navegador no permite la pantalla completa, no se exige. Tras pedirla, se esperan 2,5 s a que el navegador termine de cambiar de tamaño.

Cada salida guarda en la hoja **qué señal la provocó** (`motivos_salida`, por ejemplo `reduced,hidden`): si en algún dispositivo salen salidas que no esperas, esa columna dice la causa.

Durante un examen vigilado se pide al navegador que **mantenga la pantalla encendida**, para que el iPad no se bloquee solo mientras el alumno lee o piensa (eso contaba como salida). Funciona en iPadOS 16.4 o posterior; en versiones anteriores, sube el bloqueo automático en *Ajustes → Pantalla y brillo*.

Si el iPad congela la página mientras el alumno está en otra app, la salida se cuenta igualmente al volver, con el tiempo real que estuvo fuera.

El ratón fuera de la página **no** cuenta: se disparaba solo con acercarlo a la barra de pestañas o a la barra de desplazamiento, o con dejarlo en el borde. Si el alumno hace clic en otra ventana, lo detecta la señal de foco.

**Lo que ninguna web puede detectar.** En un iPad, una app flotante (Slide Over) que se coloca encima **sin reducir ni quitar el foco a la ventana** no emite ninguna señal. Lo mismo ocurre con un móvil o un papel junto al ordenador. La medida eficaz para esos casos es el **Acceso guiado** del iPad (o el modo de app única del centro), que además impide abrir apps flotantes. Si en algún dispositivo una salida no se cuenta, abre `diagnostico.html` en él: muestra en directo qué señales emite.

### Ver resultados

En **Mis exámenes** pulsa **Ver hoja de Google** para abrir la hoja de ese examen (una pestaña **con el título del examen**; si repites título, se añade « (2)»; puedes renombrarla sin problema), con una fila por envío:

Las hojas **nuevas** están pensadas para leerse de un vistazo: cabecera azul, filas alternas, y esta primera parte visible:

`apellidos | nombre | grupo | nota | (pendientes) | aciertos | errores | blancos | salidas | segundos_fuera | pegados | duracion_min | fecha | posible_duplicado`

La **nota** sale en verde (aprobado) o rojo; `pendientes` (preguntas abiertas sin corregir), `salidas`, `segundos_fuera` y `pegados` se marcan en color cuando son mayores que 0. Después van **ocultas** las columnas técnicas (puntos del test, respuestas y puntos de las abiertas, `tipo_envio`, `envio_id`, `motivos_salida`, `respuestas_json`); si las necesitas, selecciona las columnas vecinas y elige «Mostrar columnas». Las hojas de exámenes anteriores conservan su formato.

El alumno rellena **Nombre** y **Apellidos** en casillas separadas, y la hoja se mantiene **ordenada alfabéticamente por apellidos** (y, si coinciden, por nombre; sin distinguir tildes ni mayúsculas) cada vez que llega un envío.

Las hojas de exámenes publicados **antes** de este cambio conservan su formato (una sola columna `nombre`): ahí los nuevos envíos se guardan como «Apellidos, Nombre» y no se reordenan. Para tener la hoja ordenada, publica el examen de nuevo.

`envio_id` es un identificador interno que evita filas repetidas si un envío se reintenta. `posible_duplicado` es `TRUE` si ya había un envío con los mismos apellidos, nombre y grupo (sin tener en cuenta tildes, mayúsculas ni espacios). No se bloquea el envío; solo se marca para que lo revises.

### La pestaña «Examenes»

Es el registro de tus exámenes, con el mismo diseño que las hojas de resultados: título en negrita, **activo** en verde (abierto) o rojo (cerrado), fecha de creación legible. Las columnas técnicas (las preguntas con sus soluciones y el identificador de la hoja de resultados) quedan **ocultas**; no las borres. Al publicar un examen nuevo, la pestaña se pone bonita aunque ya la tuvieras. Puedes abrir o cerrar un examen desde el panel o cambiando `activo` a mano.

### Cerrar un examen

Desde **Mis exámenes → Cerrar examen**. Los alumnos que abran el enlace verán «Examen cerrado». Puedes volver a abrirlo cuando quieras.

### Cómo se calcula la nota

Cada acierto suma los puntos de la pregunta (**1** si no pone `[valor=N]`), cada pregunta en blanco **0** y cada error **resta una fracción de esos puntos**. Las preguntas abiertas las puntúas tú en la hoja (ver arriba); el resto de esta sección explica el test con preguntas de 1 punto.

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
4. **Publica de nuevo** los exámenes que quieras que usen las novedades (los ya publicados conservan su comportamiento y su hoja).

Si el panel te dice que el script no está actualizado (al publicar con penalización elegida, pantalla completa o imágenes), es que falta el paso 2 o el 3.

Si tu copia (fork) se creó cuando la rama por defecto no era `main`, en tu repositorio puedes renombrar esa rama a `main` (**Settings → Branches → Rename branch**) y comprobar en **Settings → Pages** que sigue publicando desde ella.

## Si los alumnos usan los iPad o los ordenadores del centro

Los filtros web de algunos centros bloquean dominios. La aplicación necesita llegar a:

- `TU_USUARIO.github.io` (la página del examen),
- `script.google.com` y `script.googleusercontent.com` (el servidor que corrige y guarda).

Si el examen no carga en los dispositivos del centro pero sí con datos móviles, pide al responsable informático que permita esos dominios. Los alumnos no inician sesión en nada.

## Qué datos se guardan

Solo **nombre, apellidos, grupo, respuestas, nota y los datos de las salidas del examen** (cuántas y cuánto tiempo, si vigilas) de cada alumno, en tu hoja de Google. Las imágenes de los enunciados también se guardan ahí. No se piden correos ni otros datos y los alumnos no tienen cuenta. No compartas la hoja con nadie: contiene las soluciones y los nombres. Recuerda informar a las familias de este tratamiento según la política de tu centro.

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
js/correction.js           Pantalla de corrección de abiertas y exportación CSV
js/gift.js                 Parser GIFT: [valor=N] y preguntas abiertas {} (función pura)
js/grading.js              Corrección ponderada y penalización fraccionaria (pura; replicada en Code.gs)
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

`tests/codegs.test.js` carga `Code.gs` con una hoja de cálculo simulada (`tests/fake-gas.js`, que imita también conversiones automáticas de Sheets como `1/3` → fecha) y comprueba que su corrección coincide con `js/grading.js` con miles de casos aleatorios. **Si cambias la lógica de corrección o el formato de las citas de imágenes en uno de los dos archivos, cámbiala también en el otro.**
