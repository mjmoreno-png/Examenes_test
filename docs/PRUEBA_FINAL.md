# Prueba de principio a fin (fase 6)

Lista de comprobación para validar la instalación real con Google. Marca cada punto.
Esta guía **no contiene soluciones**: las respuestas correctas las miras tú en tu archivo GIFT, que no está en el repositorio.

## 0. Antes de empezar

- [ ] La hoja de Google tiene el script pegado y `ADMIN_TOKEN` creado.
- [ ] La implementación está como aplicación web (*Ejecutar como: yo*, *Acceso: cualquier usuario*).
- [ ] `js/config.js` tiene la URL `/exec` y GitHub Pages está activo.
- [ ] `LA_URL?action=list&token=TU_TOKEN` responde `{"ok":true,"exams":[...]}`.
- [ ] Con un token incorrecto responde `unauthorized`.

## 1. Publicar el examen (ordenador)

- [ ] Abres `…/admin.html`, escribes el token y entras.
- [ ] Subes el examen del tema 1: la vista previa muestra **20 preguntas** y cada una tiene marcada la respuesta que esperas.
- [ ] Ajustes sugeridos para la prueba: tiempo 30 min, código de acceso generado, barajar preguntas y opciones, mostrar nota **activado**.
- [ ] Publicas: aparecen el enlace y el QR.
- [ ] En la hoja de Google han aparecido la fila del examen en `Examenes` y una pestaña con el título del examen.
- [ ] La celda `preguntas_json` contiene las soluciones (es normal: la hoja es privada). Confirma que la hoja **no está compartida** con nadie.

## 2. Hacer el examen desde el móvil

Abre el enlace (o escanea el QR) con el móvil.

- [ ] Pide **nombre**, **apellidos** (casillas separadas), grupo y código. Un código incorrecto da error; el correcto abre el examen.
- [ ] La pantalla inicial explica la puntuación («cada respuesta incorrecta resta 1/3»).
- [ ] Los botones se pulsan bien con el dedo y el texto se lee sin hacer zoom.
- [ ] «Dejar en blanco» deshace una respuesta.
- [ ] Recargas la página a mitad del examen: se conservan las respuestas y el tiempo restante sigue bajando.
- [ ] Con modo avión: el envío avisa de que no hay conexión y **no pierde** las respuestas; al volver la conexión, «Reintentar el envío» funciona.

## 3. Caso con nota calculada a mano

Contesta con exactamente estos resultados (mira tu archivo GIFT para saber cuáles son correctas e incorrectas):

| | Cantidad |
|---|---|
| Aciertos | 12 |
| Errores | 5 |
| En blanco | 3 |

Cálculo: `(12 − 5 × 1/3) / 20 × 10 = 5,1667` → **5,17**

- [ ] El alumno ve **5,17 / 10**, con 12 aciertos, 5 errores y 3 en blanco.
- [ ] En la hoja del examen hay una fila con: aciertos 12, errores 5, blancos 3, nota **5,17**, `posible_duplicado` = FALSE.
- [ ] `respuestas_json` contiene las 20 preguntas (las 3 en blanco como `null`).

Otros casos rápidos (cada uno es un envío más, con otro nombre):

| Caso | Nota esperada |
|---|---|
| 20 aciertos | 10 |
| 20 en blanco | 0 |
| 20 errores | 0 (se recorta; con «nota negativa» activada sería −3,33) |
| 16 aciertos, 2 errores, 2 en blanco | 7,67 |

## 3b. Penalización elegida

- [ ] Publica un examen con **1/4** de penalización. En la pantalla inicial del alumno pone «Cada respuesta incorrecta resta 1/4 de punto».
- [ ] Con 20 preguntas, 12 aciertos, 5 errores y 3 en blanco, la nota es **(12 − 5 × 1/4) / 20 × 10 = 5,38**. Comprueba que la hoja y el alumno ven ese valor.
- [ ] Publica otro con **«Sin penalización»**: los errores no restan y la pantalla inicial dice «Las respuestas incorrectas no restan».
- [ ] Publica otro con una fracción propia (por ejemplo 2/5) y comprueba la columna `penalizacion` de la pestaña `Examenes` (debe verse `2/5`, no una fecha).

## 3c. Nombre, apellidos y orden

- [ ] La pantalla inicial tiene **Nombre** y **Apellidos** por separado; si falta uno, avisa de cuál.
- [ ] Envía tres exámenes con alumnos de prueba, por ejemplo «Marta Zapata», «Pedro Álvarez» y «Luis Benítez». En la hoja del examen, las filas aparecen **ordenadas por apellidos**: Álvarez, Benítez, Zapata (las tildes no alteran el orden), con las columnas `apellidos` y `nombre` separadas.
- [ ] Dos alumnos con los mismos apellidos quedan ordenados por nombre.

## 3d. Imágenes en las preguntas

- [ ] Añade al GIFT una pregunta con `![descripción](figura1.png)` y otra con otra imagen. Al cargarlo, el panel lista «Imágenes de las preguntas» con «falta» en cada una y **no deja publicar**.
- [ ] Selecciona tus PNG: aparecen con su miniatura, tamaño reducido y KB; una foto pesada queda en unos 150 KB. La vista previa muestra las imágenes.
- [ ] Publica. En la hoja aparece la pestaña `Imagenes` con filas troceadas.
- [ ] Como alumno, en el móvil y en el iPad, las imágenes se ven **dentro del ancho de la pantalla**, nítidas, y no se pueden arrastrar ni seleccionar.
- [ ] Con un examen con código de acceso, las imágenes solo llegan tras acertar el código.
- [ ] Con 30 móviles abriendo el examen a la vez, todos cargan (la primera lectura llena una caché de 6 horas).

## 4. Duplicados, cierre y límites

- [ ] Repites el envío con el mismo nombre y grupo, cambiando tildes o mayúsculas (por ejemplo «MARTA RUIZ» en vez de «Marta Ruiz»): la fila nueva sale con `posible_duplicado` = TRUE y no se bloquea.
- [ ] Panel → **Mis exámenes** muestra el número correcto de envíos y **Ver resultados** abre su hoja de resultados.
- [ ] **Cerrar examen**: al abrir el enlace el alumno ve «Examen cerrado», y un alumno que ya lo tenía abierto no puede enviar.
- [ ] **Abrir examen** lo reactiva.
- [ ] Probar el tiempo límite: publica un examen de 1 minuto, empieza y espera: al llegar a 0 se envía solo con lo contestado.

## 4b. Examen vigilado (control de salidas)

Publica un examen con **Vigilar salidas** marcado y **2 salidas permitidas** (así se prueba rápido; el alumno nunca ve este número). Hazlo desde un iPad o móvil, con un nombre distinto en cada prueba:

- [ ] La pantalla inicial dice que **no se puede salir** de la pantalla del examen y que, si continúa saliendo, se enviará automáticamente. **No** menciona cuántas salidas se permiten, y durante el examen **no hay ningún contador** de salidas.
- [ ] No se puede seleccionar ni copiar el texto de las preguntas.
- [ ] **Salida 1:** sal a la pantalla de inicio, espera unos 5 segundos y vuelve. Aparece un aviso rojo («AVISO: has salido del examen… Está prohibido… si continúas saliendo, el examen se enviará») y **sigues pudiendo hacer el examen** con tus respuestas intactas. En la hoja todavía **no hay fila**.
- [ ] **Salida 2:** igual. El aviso aparece de nuevo y sigues dentro.
- [ ] **Salida 3:** al salir por tercera vez y volver, el examen aparece enviado, con el aviso «se ha enviado automáticamente porque has salido de la pantalla del examen».
- [ ] En la hoja del examen hay **una sola fila** con `salidas` = 3, `tipo_envio` = `salida` y `segundos_fuera` con la suma del tiempo de las salidas.
- [ ] Prueba con otro nombre: sal **una vez** y envía tú el examen con el botón. La fila debe tener `salidas` = 1, `tipo_envio` = `manual` y `segundos_fuera` > 0.
- [ ] Prueba con otro nombre: sal una vez y **recarga la página** sin enviar. Al volver a entrar con el mismo nombre y grupo, sigues dentro del examen (verás el aviso rojo).
- [ ] Prueba cambiar de pestaña y bloquear la pantalla: ambas cuentan como salida.
- [ ] **Pantalla dividida (iPad):** con el examen en una mitad y otra web en la otra, el examen cuenta **1 salida** (por el cambio de tamaño de la ventana), aunque no toques la otra web, y el tiempo corre hasta que vuelves a pantalla completa. Si no cuenta, abre `diagnostico.html` en el iPad, repite la prueba y revisa qué señales aparecen.
- [ ] **Pantalla dividida:** mientras la ventana del examen esté reducida, las preguntas **desaparecen** y se ve «Examen oculto. Vuelve a la pantalla completa…». Al volver a pantalla completa aparece el aviso rojo y las respuestas siguen ahí.
- [ ] Si recargas la página estando en pantalla dividida, el examen sigue oculto y **no** suma otra salida.
- [ ] A pantalla completa **no** aparece nunca la cubierta (si apareciera, hay un falso positivo: abre `diagnostico.html` y mira la «Proporción»).
- [ ] **Ordenador (PC o Mac):** al pulsar «Empezar» el examen pasa a pantalla completa. Pulsa **Esc** para salir de ella: el examen se oculta, aparece «Volver a pantalla completa» y, al pulsarlo, vuelve el examen con el aviso rojo.
- [ ] **Ordenador:** pon otra ventana al lado o encima y haz clic en ella: el examen se oculta. Mover el ratón fuera de la página (a la barra de pestañas, a la barra de desplazamiento o a otro monitor) **no** cuenta como salida.
- [ ] **iPad:** al pulsar «Empezar» mira si pasa a pantalla completa (si no lo permite, no se exige). Abre una app flotante (Slide Over) encima **sin** reducir la ventana: puede que no se detecte (ver README). Anota qué pasa; `diagnostico.html` muestra las señales.
- [ ] **Sin «Exigir pantalla completa»** (lo normal): al pulsar «Empezar» el examen **no** pasa a pantalla completa y `salidas` se queda en 0. Pon otra app al lado (pantalla dividida): se oculta y cuenta una salida. Si empiezas ya en pantalla dividida, aparece «Pon el examen a toda la pantalla» sin penalizar.
- [ ] **Con «Exigir pantalla completa» marcada:** al pulsar «Empezar» pasa a pantalla completa; si sales de ella y no vuelves en unos segundos, el examen se oculta y aparece el botón para volver.
- [ ] **Empezar sin pantalla completa (solo si la exiges):** si el examen no llega a pasar a pantalla completa, aparece «Pon el examen a pantalla completa. Esto todavía no cuenta como salida» y **no** se suma ninguna salida. Al pasar a pantalla completa (botón o un toque), el examen aparece y la hoja marca `salidas` = 0.
- [ ] **Gestos naturales del iPad** (deslizar para el centro de control o las notificaciones, mostrar la barra de apps y volver enseguida, girar el iPad): **no** deben sumar salidas. Si alguno lo hace, mira la columna `motivos_salida` de la hoja o `diagnostico.html` y apúntame cuál.
- [ ] Si la pantalla completa se pierde por un gesto, un **toque** en cualquier parte la restaura sin penalización.
- [ ] Girar el iPad (vertical/horizontal) **no** cuenta como salida.
- [ ] **iPad, desplazarse con el dedo:** sube y baja por el examen deslizando desde distintas zonas, también cerca de los bordes de abajo y de arriba: **no** suma salidas.
- [ ] **iPad, otra app de verdad:** sal a otra app unos segundos y vuelve: cuenta **1 salida** con el tiempo fuera correcto.
- [ ] **iPad sin tocar:** deja el examen abierto más tiempo que el bloqueo automático del iPad: la pantalla **no** se apaga y no suma salidas.
- [ ] **iPad con zoom:** amplía con dos dedos una pregunta o una imagen unos segundos: **no** cuenta como salida.
- [ ] **iPad, ocultar el teclado:** escribe en una pregunta abierta y pulsa la tecla de ocultar teclado (abajo a la derecha); espera 10 s sin tocar nada: **no** aparece el aviso ni suma salidas.
- [ ] **Tableta con pregunta abierta:** toca el cuadro de texto y escribe un rato con el teclado en pantalla: **no** cuenta como salida.
- [ ] En un examen **sin** vigilar, cambiar de app no cuenta nada ni avisa.
- [ ] Un examen publicado antes de esta versión sigue funcionando.

## 5. Privacidad (importante)

- [ ] Abre el repositorio en GitHub (o una ventana de incógnito): **no** hay ningún `.gift` ni `.txt` con exámenes, ni el token.
- [ ] Abre `…/index.html?e=ID` y revisa las herramientas de desarrollo (pestaña *Red*): la respuesta del examen **no incluye** el campo `correct`.
- [ ] La hoja de Google sigue sin compartirse.

## Si algo falla

Anota el mensaje exacto que aparece, la hora y si ocurrió en ordenador o móvil. La sección «Problemas frecuentes» del [README](../README.md) cubre los casos más comunes. En el editor de Apps Script, **Ejecuciones** muestra los errores del servidor.

## Preguntas abiertas y puntos por pregunta

- [ ] Publica un GIFT con `::T1::[valor=2] …{=a~b}`, una de 1 punto y `::A1::[valor=3] Explica…{}`. En la vista previa del panel salen el valor de cada pregunta y «Total: 6 puntos».
- [ ] Con un `Code.gs` antiguo el panel **no publica** y avisa de que hay que actualizar el script.
- [ ] El alumno ve un cuadro de texto en la abierta; al pegar (Ctrl+V / mantener pulsado → Pegar) no entra nada y en la hoja aparece `pegados` ≥ 1.
- [ ] Tras enviar, el alumno ve «Parte tipo test: X sobre Y puntos» y que las abiertas las corrige el profesor, sin nota final.
- [ ] En «Mis exámenes» aparece **Corregir abiertas**. Se ven las respuestas en cajas legibles; escribe 2 en una (Intro): sale «Guardado ✓» y el progreso sube.
- [ ] En la hoja del examen: la hoja se ve limpia (cabecera azul, filas alternas), `nota` se actualiza sola con la corrección, `pendientes` baja a 0 y las columnas técnicas están ocultas (selecciona las vecinas → «Mostrar columnas»).
- [ ] **Exportar notas (CSV)** descarga un archivo que abre bien en Excel (acentos, coma decimal).
