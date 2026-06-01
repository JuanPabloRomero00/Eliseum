# Eliseum

Micro-orquestador de ingesta y monitoreo reactivo implementado con Node.js nativo.

## Objetivo

El sistema recibe ráfagas de requests a `/ingest`, delega el trabajo pesado a un `Worker Thread` para no bloquear el `Event Loop`, mantiene un conteo exacto con `SharedArrayBuffer + Atomics`, y ejecuta la API detrás de un `cluster` con `self-healing`.

## Requisitos que cubre

- `cluster` usando la mitad de los núcleos disponibles.
- distribución `round robin` de conexiones entre workers.
- recreación automática de workers caídos.
- endpoint `/health` con respuesta inmediata.
- endpoint `/ingest?id=...` con cálculo pesado fuera del hilo principal.
- conteo exacto de eventos con `Atomics.add`.
- prueba de carga con `500` requests concurrentes.
- demo separada de resiliencia con caída simulada de workers.

## Estructura

```text
src/
  app.js                  entrada principal con cluster
  server.js               arranque simple sin cluster
  cluster/                master y boot del cluster
  worker/                 servidor HTTP, routing y boot de cada worker
  threads/                worker thread fijo para ingesta
  shared/                 memoria compartida y operaciones atómicas
  handlers/               controladores HTTP
  services/               lógica de negocio desacoplada
  middlewares/            logging y manejo de errores
  config/                 configuración centralizada
  utils/                  helpers y constantes
test/
  load-test.js            prueba de carga y chaos drill
```

## Endpoints

### `GET /health`

El `totalCount` global se consolida en el master de forma idempotente por `ingestId`, para no duplicar eventos si una ingesta se reintenta durante una caida o reinicio.

Devuelve el estado del worker que atendió la request.

Ejemplo:

```json
{
  "status": "ok",
  "pid": 2256,
  "localCount": 141,
  "totalCount": 500
}
```

Campos:

- `pid`: proceso worker que respondió.
- `localCount`: cantidad procesada por el thread de ese worker.
- `totalCount`: contador global agregado por el master.

### `GET /ingest?id=123`

Dispara una tarea de cálculo pesado en el `Worker Thread` del worker actual y devuelve el resultado junto con el conteo.

### `GET /chaos`

Ruta de demo para resiliencia. Algunos workers nacen con `crash-armed=yes` según una probabilidad configurable del `25%`. Si un worker armado recibe `/chaos`, responde con su estado real y luego se cae de forma simulada. El master detecta la caída y hace `fork` de un nuevo worker.

Ejemplo:

```json
{
  "status": "armed",
  "pid": 2256,
  "crashProbability": 0.25,
  "willCrashAfterResponse": true
}
```

Campos:

- `status`: `armed` si ese worker va a caer al terminar la respuesta; `safe` si no.
- `pid`: proceso worker que respondió.
- `crashProbability`: probabilidad configurada para armar workers al nacer.
- `willCrashAfterResponse`: indica explícitamente si esa request va a disparar la caída simulada.

## Formato de error

Cuando una request falla, la API responde en JSON con este formato:

```json
{
  "error": {
    "code": "INVALID_INGEST_ID",
    "message": "Invalid ingest request",
    "details": "Query param 'id' must be a non-negative integer"
  }
}
```

Ejemplos comunes:

- `INVALID_INGEST_ID`: el `id` no es un entero no negativo.
- `INGESTION_THREAD_UNAVAILABLE`: el worker no puede procesar la ingesta en ese momento.

## Ejecución

Requisitos:

- Node.js 22 o superior.

Scripts disponibles:

```bash
npm start
npm run start:single
npm run test:load
npm run test:resilience
```

### `npm start`

Levanta el sistema completo con `cluster`.

### `npm run start:single`

Levanta un solo worker, sin cluster. Sirve para pruebas puntuales.

### `npm run test:load`

Ejecuta la validación completa:

1. levanta la app;
2. espera a que `/health` responda;
3. dispara `500` requests concurrentes a `/ingest`;
4. dispara requests paralelas a `/health`;
5. verifica que `totalCount` termine en `500`;
6. ejecuta un `chaos drill` sobre `/chaos`;
7. verifica que el sistema siga respondiendo después de la caída y reposición de workers.

Si querés correr la simulación contra una app ya levantada aparte, usá:

```bash
USE_EXISTING_SERVER=1 npm run test:load
```

En Windows PowerShell:

```powershell
$env:USE_EXISTING_SERVER="1"
npm run test:load
```

### `npm run test:resilience`

En este modo, el cliente reintenta fallas transitorias de red o respuestas `5xx`, y el contador global mantiene exactitud sin duplicar ingestas ya consolidadas.

Ejecuta una variante mÃ¡s agresiva:

1. dispara `500` requests concurrentes a `/ingest`;
2. dispara requests paralelas a `/health`;
3. dispara requests a `/chaos` al mismo tiempo que la carga;
4. verifica que el `totalCount` final siga avanzando correctamente aunque haya caÃ­das y reposiciÃ³n de workers.

Sirve para observar resiliencia bajo carga real, no solo despuÃ©s de la carga.

## Variables de entorno

Todas son opcionales.

```bash
PORT=8080
HOST=127.0.0.1
SIMULATED_CRASH_PROBABILITY=0.25
BASE_URL=http://127.0.0.1:8080
REQUEST_LOGGING_ENABLED=1
```

Notas:

- `SIMULATED_CRASH_PROBABILITY` define qué porcentaje de workers nacen armados para caer ante `/chaos`.
- `BASE_URL` se usa en el script de prueba.
- `REQUEST_LOGGING_ENABLED=0` desactiva el log por request, útil para `npm run test:load`.
- `USE_EXISTING_SERVER=1` hace que el script de carga no levante la app y use una instancia ya corriendo.

## Qué se ve en consola

### Inicio del cluster

```text
[master:8916] [######] BOOT   | active=6/6 | restarts=0 | total=0 | cluster starting
[master:8916] [######] UP   + | active=6/6 | restarts=0 | total=0 | worker=14300
```

### Caída simulada y self-healing

```text
[master:8916] [#####.] DOWN x | active=5/6 | restarts=1 | total=500 | worker=8728 code=1 signal=none
[master:8916] [######] UP   + | active=6/6 | restarts=2 | total=500 | worker=16240
```

Interpretación:

- `#` representa un worker activo.
- `.` representa un worker faltante antes de la reposición.
- `DOWN x` indica caída detectada.
- `UP +` indica worker repuesto por el master.

## Decisiones de diseño

- Se evitó usar frameworks como Express para mantener el sistema mínimo y centrado en los conceptos del TP.
- El cálculo pesado vive en `src/threads/ingestionWorker.js`, no en el `Event Loop` del worker HTTP.
- El conteo local de cada worker usa memoria compartida con su thread y `Atomics.add`.
- El conteo global visible en `/health` lo consolida el master a través de IPC.
- La demo de resiliencia se separó de `/ingest` para no mezclar la validación de concurrencia correcta con la validación de self-healing.

## Limitaciones conocidas

- `/health` sigue siendo responsivo bajo carga, pero su latencia no es necesariamente cercana a `0ms` en una máquina real.
- El `totalCount` global consolidado depende del flujo de mensajes IPC entre workers y master.
- La deduplicacion global asume que cada evento conserve un `ingestId` estable entre retries.
- La simulación de caída está pensada para demo y evaluación, no para un entorno productivo.
