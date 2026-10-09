# Alineación experimental de letras — Tauri macOS

## Ajuste v2

Qwen ahora conserva las palabras válidas de una frase aunque otra tenga duración cero. Las palabras rechazadas se reintentan con hasta una frase vecina a cada lado, incluyendo tanto el audio como su texto y manteniendo el límite de 28 segundos. No se cruzan idiomas ni se reutiliza un resultado si la cobertura textual no coincide exactamente.

Un reintento no puede desplazar una palabra ya aceptada. Los conflictos con palabras de respaldo se resuelven descartando propuestas, sin fabricar duraciones ni estirar intervalos. El informe distingue palabras aceptadas en la primera pasada, recuperadas con contexto y conservadas del respaldo. La versión guardada es `qwen3-sofa+acoustic-experimental-v2`.

Validación de v2: 20 pruebas Python aprobadas. Por petición del usuario, la evaluación auditiva y las pruebas con canciones quedan a su cargo; los números de canciones que aparecen abajo corresponden a v1.

Implementada el 8 de septiembre de 2026 para Apple Silicon. En Crear letra se puede elegir **Qwen + SOFA · experimental** o **MFA · clásico**. El motor experimental instala sus dependencias en un entorno privado y reutiliza las voces separadas existentes. Los modelos se descargan aparte del DMG.

## Flujo implementado

1. Demucs conserva la pista vocal; MLX Whisper y la conciliación de letra existente producen el borrador que revisa el usuario.
2. MFA genera una base conservadora por palabras/fonemas, sin ejecutar todavía pYIN.
3. Qwen3-ForcedAligner alinea cada frase con su texto exacto. Las ventanas duran como máximo 28 segundos y no invaden los tiempos de las frases vecinas. Se exige cobertura completa, orden, duraciones positivas y desplazamientos acotados. Una frase rechazada conserva la base.
4. SOFA intenta obtener fonemas en todas las frases inglesas elegibles, incluso si Qwen falló. Solo incorpora evidencia próxima a los bordes aceptados. Una palabra ausente del diccionario impide usar SOFA en esa frase, evitando su omisión silenciosa.
5. MFA vuelve a refinar las frases españolas sobre los tiempos aceptados de Qwen. Las frases inglesas conservan la evidencia de SOFA.
6. Las sílabas requieren coincidencia entre divisiones ortográficas y núcleos vocálicos acústicos. pYIN se ejecuta al final para sostenidos y notas. La validación de Rust comprueba la contención temporal antes de guardar.

Los fallos del motor experimental conservan MFA o los tiempos revisados del borrador. `alignmentNotes` informa del motor utilizado y los respaldos; `experimental-alignment/alignment-report.json` en la caché registra decisiones por frase. No se interpreta la confianza de transcripción como una probabilidad de precisión temporal. RMVPE no se incorporó en esta versión.

## Modelos y entorno

- [Qwen3-ForcedAligner MLX 8-bit](https://huggingface.co/mlx-community/Qwen3-ForcedAligner-0.6B-8bit), revisión `0e1a68e91d815300c7c9754b2a7639378b23db15`, mediante `mlx-audio==0.5.3`.
- [SOFA](https://github.com/qiuqiao/SOFA), revisión `9549c6a86d16019c817eefe4bb8183405da524cc`.
- [Modelo inglés tgm_en_v100 y diccionario](https://github.com/spicytigermeat/SOFA-Models), checkpoint de 406.079.728 bytes. El instalador comprueba SHA-256 para código SOFA, checkpoint y diccionario.
- Python 3.11, PyTorch 2.5.1; Qwen usa MLX y SOFA CPU con cuatro hilos. Qwen se libera antes de cargar SOFA.
- Ubicación: `~/Library/Application Support/com.staysound.desktop/lyrics-experimental/`. En esta máquina ocupa aproximadamente 3,2 GiB en disco entre entorno y activos. El nombre de un paquete Python pequeño no representa el tamaño de sus pesos/dependencias.
- Los scripts van embebidos en Rust. El binario no necesita el checkout del proyecto para funcionar. Los modelos se cargan localmente durante la alineación.

## Pruebas realizadas

Mac Apple M5 Pro, 24 GiB de memoria unificada. Se utilizaron las voces separadas y letras guardadas de la biblioteca, sin sobrescribir las letras originales durante el benchmark.

| Prueba | Resultado observado |
| --- | --- |
| Powerless — Linkin Park | 25 frases, 146 palabras. Qwen aceptó 6 frases y rechazó 19; SOFA aportó fonemas a 46 palabras. El resultado tuvo 9 palabras con varias sílabas acústicamente respaldadas. |
| Tiempo de Powerless | 55,27 s para Qwen + SOFA + pYIN sobre una base MFA ya calculada. No incluye separación, transcripción, instalación ni MFA inicial. RSS máximo 2,81 GB; peak memory footprint 3,33 GB, según `/usr/bin/time -l`. |
| Lo Que Yo Te Di — CD9 | 51 frases, 277 palabras. Qwen aceptó 23 frases y conservó la base en 28. Qwen + pYIN tardó 69,37 s; la pasada adicional de MFA terminó correctamente y produjo evidencia fonética en 121 palabras. |
| Regresiones Python | 15 pruebas aprobadas, incluidas duración cero, tokens omitidos/extra, contracciones, repeticiones, intervalos solapados y valores no finitos. |
| Rust | `cargo check` y 5 pruebas de karaoke aprobados. |
| Empaquetado | Vite y Tauri completaron app + DMG para aarch64, sin generar artefactos de actualización firmados. |

El chequeo TypeScript global sigue mostrando cuatro errores fuera de los archivos del motor: `tauriUpdater.ts`, `importLocalFiles.ts`, `tidalDiscovery.ts` y `webLibraryStore.ts`. No se corrigieron como parte de este cambio. La compilación Vite sí termina.

Estos resultados comprueban funcionamiento y rechazo de salidas inválidas; **no demuestran una mejora de precisión auditiva**. Qwen produjo palabras de duración cero en canto y necesita el respaldo. Para promover el motor a estable hace falta una comparación ciega con inicios/finales anotados manualmente en canciones representativas (repeticiones, voces superpuestas, notas largas y mezcla de idiomas), midiendo error mediano/P95 y porcentaje dentro de 100/200 ms.
