# Auditoría de lyrics: POWERLESS, Tauri macOS

Fecha: 2026-09-07. Los hallazgos iniciales describen el motor antes de la corrección. La implementación y validación posteriores se documentan al final. Los tiempos indicados son los guardados; no constituyen anotaciones auditivas de referencia.

## Fuentes locales

- Motor: `src-tauri/src/karaoke.rs`.
- Corrección de texto: `web/src/components/LocalLyricsGenerator.tsx`.
- Sostenidos: `src-tauri/python/refine_sustains.py`.
- Caché: `~/Library/Caches/com.staysound.desktop/karaoke/0b943841d9f363c6/` (contiene la voz separada de `Linkin Park - POWERLESS`).
- Resultado persistido: `~/Library/Application Support/com.staysound.desktop/generated-lyrics/0b943841d9f363c6.json`.

## Cómo funciona

1. Demucs `htdemucs` separa voz e instrumental.
2. MLX Whisper `mlx-community/whisper-large-v3-turbo` transcribe la voz y estima tiempos de palabra.
3. El frontend reconcilia esa transcripción con la letra del proveedor. En este caso es BiniLyrics. Empareja tokens por similitud y estima posiciones de palabras no reconocidas mediante interpolación. El `textMatch` de 0.9726027 mide coincidencia textual, no exactitud temporal.
4. MFA recibe clips por línea y el texto corregido. El modelo `english_mfa` genera intervalos de palabras y fonemas. El posprocesado conserva los inicios previos y reescala los fonemas dentro de esos intervalos.
5. Pyphen propone divisiones escritas. El código intenta casar esas divisiones con núcleos vocálicos; si no coinciden, reparte el tiempo según la longitud de cada fragmento.
6. Librosa pYIN y energía vocal buscan prolongaciones de la última sílaba. Esta etapa puede extender finales, pero no corregir comienzos ni acortar finales excesivos. No es otro modelo generativo de letras.

## Fallos comprobados

### P1: el detector de vocales no corresponde al alfabeto del modelo

`is_vowel` espera prefijos ARPAbet para inglés, pero los JSON reales de MFA contienen IPA. Ejecutando la función actual en el runtime instalado, `ɛ`, `ə`, `ɪ`, `ɑ`, `ɚ`, `ʉː`, `aj` e `iː` resultan falsos. `aw` y `ow` se reconocen incidentalmente al convertirlos a mayúsculas.

En las 26 palabras con múltiples fragmentos de esta canción, ninguna tiene coincidencia entre número de fragmentos y núcleos reconocidos por el detector. Por tanto, los cortes internos se calculan por longitud del texto, no por núcleos vocales medidos.

Ejemplos del resultado persistido:

| Tiempo | Palabra | Evidencia |
|---|---|---|
| 00:13.400 | skeletons | Se divide en `skele` / `tons`, aunque los fonemas contienen tres núcleos vocálicos. |
| 00:25.885–00:26.097 | evidence | El fragmento `i` contiene solamente `vʲ`. |
| 01:05.840–01:06.253 | powerless | `pow` contiene solamente `pʰ`; su vocal `aw` cae en `er`. |
| 02:13.207–02:13.518 | powerless | `er` contiene solamente `l`. |
| 03:28.127–03:28.438 | powerless | `er` tiene una lista vacía de fonemas. |

Pyphen es una herramienta de división tipográfica, no un silabificador del canto: https://pyphen.org/. Incluso arreglando IPA, no debe suponerse que sus divisiones equivalen a sílabas pronunciadas.

### P1: MFA no puede corregir los inicios de palabra

Los 146 inicios del archivo de entrada son idénticos a los del resultado alineado. Tanto la rama de confianza mayor a 0.15 como la de confianza baja conservan la posición previa. La confianza de reconocimiento textual se utiliza como si garantizara el tiempo.

Además, el clip comienza justo en el inicio estimado de la primera palabra: un inicio tardío puede recortar el audio que se necesita para corregirlo.

Tampoco sería seguro aceptar todo MFA: hay desacuerdos enormes. Para la primera palabra, la propuesta cruda es 12.330 s frente a 11.500 s de entrada; para una aparición del título, 61.700 s frente a 65.840 s. Estas diferencias son señales de revisión, no prueba de cuál motor tiene razón. Reescalar automáticamente sus fonemas puede introducir una precisión aparente.

### P2: palabras interpoladas reciben una apariencia de alineación fiable

La palabra `it` a 116.120–116.160 s dura 40 ms y tiene confianza cero. El refinamiento mantiene ese intervalo. Debe identificarse como estimación pendiente de resolver acústicamente.

### P2: los sostenidos pueden propagar problemas previos

El análisis solo examina la última sílaba y solo permite extensiones. Si las sílabas ya están mal cortadas, puede prolongar el fragmento equivocado. La detección de tono en voz separada tampoco distingue por sí sola voz principal, coros, reverberación y residuos instrumentales.

En la aparición a 198.000 s, el final pasa de 199.400 a 203.605 s en el conjunto del proceso MFA + acústica. Es una extensión de 4.205 s que necesita validación contra la voz, no un error auditivo demostrado por esta revisión.

## Afinación recomendada, en orden

1. Corregir la detección de núcleos para el inventario IPA real y probar variantes con longitud, diacríticos, diptongos y consonantes silábicas. Conservar compatibilidad con ARPAbet donde corresponda.
2. Dejar de presentar divisiones por caracteres como sílabas acústicas. Si no existe una correspondencia fiable entre grafemas y fonemas, usar temporalmente una sola unidad por palabra. Para conservar detalle silábico hace falta una correspondencia explícita entre pronunciación y texto.
3. Separar confianza textual y temporal. Evaluar inicios Whisper/MFA con márgenes de audio, continuidad, orden y evidencia acústica. Reprocesar localmente los desacuerdos grandes; no elegir ciegamente un motor.
4. Resolver palabras interpoladas con alineación local y marcar las que sigan sin evidencia. El porcentaje de texto no debe presentarse como precisión de sincronización.
5. Revisar sostenidos después de estabilizar palabras y sílabas, usando referencias anotadas en varias repeticiones del coro y el cierre.

## Validación realizada y pendiente

Realizado: lectura de los 25 renglones y 146 palabras, comparación entrada/salida MFA y resultado persistido, inspección de fonemas crudos y reproducción del detector de vocales con las funciones del código actual y el runtime instalado.

Pendiente: comparación auditiva y visual dentro de Tauri y anotaciones manuales sobre la voz para medir error de inicio/final. La revisión demuestra defectos de construcción de los datos; no permite afirmar todavía el desfase perceptivo exacto de cada palabra.

## Corrección implementada y validada

Después de la autorización del usuario se implementó `src-tauri/python/phoneme_timing.py`, embebido por Rust en el trabajo de alineación:

- Reconoce IPA, diacríticos y consonantes silábicas, además de ARPAbet.
- Usa límites entre núcleos vocales cuando coinciden con los fragmentos escritos. Si no coinciden, conserva la palabra completa; no reparte sílabas por longitud de texto.
- Acepta correcciones de inicio de hasta 180 ms solo si también concuerdan el final (hasta 350 ms), la duración y los límites vecinos, y existen vocales medidas. Son filtros conservadores, no una medida calibrada de precisión.
- Evita reescalar los fonemas de alineaciones rechazadas. Estas palabras mantienen una unidad de presentación y los tiempos previos, sujetos a limpieza de solapamientos.
- Añade hasta 180 ms de audio antes de una línea cuando la línea anterior deja espacio.
- Impide que el refinamiento acústico prolongue palabras interpoladas de confianza cero o salte una entrada de la siguiente línea situada cerca del final anterior.
- Identifica el porcentaje de la interfaz como coincidencia de texto.
- Versiona los resultados como `mfa-phoneme+acoustic-v3` (y variante bilingüe).

Se ejecutó MFA de nuevo sobre las 25 líneas de la voz separada real, seguido de pYIN. Resultado: 146 palabras preservadas, 21 inicios ajustados entre 20 y 170 ms en valor absoluto, y cinco apariciones del título conservadas como palabra completa. Solo dos palabras mantienen subdivisión silábica con evidencia suficiente en esta pasada; la mayor parte de los intervalos MFA discrepan demasiado de Whisper para aceptarlos con estos filtros. Esto reduce detalle aparente, pero elimina divisiones sin respaldo acústico.

Todos los intervalos de palabras, sílabas y notas quedaron dentro de sus contenedores y con duración positiva. En las palabras subdivididas, cada fragmento tiene un núcleo reconocido. El resultado se guardó en el JSON local de POWERLESS; el anterior está en `generated-lyrics/backups/0b943841d9f363c6-before-ipa-refinement-20260907-153203.json` dentro de Application Support.

Validación automatizada: 10 pruebas Python aprobadas, incluidas pronunciaciones reducidas, tiempos desiguales, rechazos de MFA, puntuación y sostenidos sintéticos; 5 pruebas Rust del módulo aprobadas. La compilación web y la app Tauri de macOS finalizaron correctamente. Bundle local: `src-tauri/target/release/bundle/macos/StaySound.app`. No se publicó una actualización ni se reemplazó una instalación en Applications. Reiniciar la app permite leer el resultado guardado en lugar de su copia en memoria.

La validación acústica final por escucha sigue pendiente: los ajustes pequeños están respaldados por los filtros y por MFA, pero no se dispone todavía de tiempos manuales de referencia para afirmar una mejora numérica de precisión perceptiva.
