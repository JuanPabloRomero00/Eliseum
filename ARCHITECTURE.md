# The Guardian - Micro-Orquestador de Ingesta y Monitoreo Reactivo

**Trabajo Práctico Nº 2 - Programación sobre Redes**

---

## Estructura de Carpetas

```bash
src/
├── cluster/                  # Gestión del Cluster y Self-Healing
│   ├── master.js             # Lógica del proceso Master
│   └── index.js              # Setup del cluster
│
├── worker/                   # Proceso Worker (cada fork)
│   ├── server.js             # Creación del servidor HTTP
│   ├── routes.js             # Definición de rutas
│   └── index.js              # Inicialización del worker
│
├── threads/                  # Worker Threads
│   ├── ingestionWorker.js    # Worker Thread que procesa los eventos
│   └── index.js              # Factory para crear el thread
│
├── shared/                   # Memoria compartida por hardware
│   └── counter.js            # SharedArrayBuffer + Atomics
│
├── handlers/                 # Controladores de rutas (HTTP)
│   ├── healthHandler.js
│   └── ingestHandler.js
│
├── services/                 # Lógica de negocio (desacoplada)
│   └── ingestionService.js
│
├── middlewares/              # Middlewares generales
│   ├── errorHandler.js
│   └── logger.js
│
├── config/
│   └── index.js              # Configuración centralizada
│
├── utils/
│   ├── helpers.js
│   └── constants.js
│
├── app.js                    # Archivo principal (entrada)
├── server.js                 # (Opcional) Servidor puro
│
test/
└── load-test.js              # Script de prueba (500 peticiones + health)