const { HOST, PORT, SIMULATED_CRASH_PROBABILITY } = require("../config");
const { ERROR_CODES } = require("../utils/constants");
const { shouldSimulateCrash, createAppError } = require("../utils/helpers");
const { createHealthHandler } = require("../handlers/healthHandler");
const { createIngestHandler } = require("../handlers/ingestHandler");
const { createChaosHandler } = require("../handlers/chaosHandler");
const { createIngestionService } = require("../services/ingestionService");
const { createRoutes } = require("./routes");
const { createServer } = require("./server");

function startWorker() {
  let totalCount = 0;
  let hasSimulatedCrash = false;
  const shouldCrashThisLifecycle = shouldSimulateCrash(
    SIMULATED_CRASH_PROBABILITY
  );

  const ingestionService = createIngestionService({
    onGlobalIncrement(payload) {
      if (process.send) {
        process.send({
          type: "increment",
          payload,
        });
        return;
      }

      console.error(
        `[worker:${process.pid}] ${ERROR_CODES.WORKER_IPC_SEND_FAILED} | master IPC channel not available`
      );
    },
  });

  process.on("message", (message) => {
    if (!message || typeof message !== "object") {
      console.error(
        `[worker:${process.pid}] ${ERROR_CODES.INVALID_CLUSTER_MESSAGE} | ignored non-object IPC message`
      );
      return;
    }

    if (message.type === "global-count") {
      if (typeof message.payload?.totalCount !== "number") {
        console.error(
          `[worker:${process.pid}] ${ERROR_CODES.INVALID_CLUSTER_MESSAGE} | missing numeric totalCount`
        );
        return;
      }

      totalCount = message.payload.totalCount;
    }
  });

  const healthHandler = createHealthHandler({
    getTotalCount: () => totalCount,
    getLocalCount: () => ingestionService.getLocalCount(),
  });

  const ingestHandler = createIngestHandler({ ingestionService });
  const chaosHandler = createChaosHandler({
    crashProbability: SIMULATED_CRASH_PROBABILITY,
    isCrashArmed: () => shouldCrashThisLifecycle,
    hasSimulatedCrash: () => hasSimulatedCrash,
  });
  const routeRequest = createRoutes({
    healthHandler,
    ingestHandler,
    chaosHandler,
  });
  const server = createServer({ routeRequest });

  server.listen(PORT, HOST, () => {
    console.log(
      `[worker:${process.pid}] listening on http://${HOST}:${PORT} | crash-armed=${shouldCrashThisLifecycle ? "yes" : "no"}`
    );
  });

  server.on("error", (error) => {
    const appError = createAppError({
      code: ERROR_CODES.SERVER_LISTEN_FAILED,
      message: `Worker server failed to listen on ${HOST}:${PORT}`,
      details: error.message,
      cause: error,
    });

    console.error(
      `[worker:${process.pid}] ${appError.code} | ${appError.message} | ${appError.details}`
    );

    process.exit(1);
  });

  server.on("request", (request, response) => {
    if (request.method !== "GET" || !request.url.startsWith("/chaos")) {
      return;
    }

    response.on("finish", () => {
      if (hasSimulatedCrash) {
        return;
      }

      if (!shouldCrashThisLifecycle) {
        return;
      }

      hasSimulatedCrash = true;

      console.error(
        `[worker:${process.pid}] x simulated crash triggered after ${request.url}`
      );

      setTimeout(() => {
        process.exit(1);
      }, 25);
    });
  });

  async function shutdown() {
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(
              createAppError({
                code: ERROR_CODES.SERVER_CLOSE_FAILED,
                message: "Worker server failed while closing",
                details: error.message,
                cause: error,
              })
            );
            return;
          }

          resolve();
        });
      });

      await ingestionService.dispose();
      process.exit(0);
    } catch (error) {
      console.error(
        `[worker:${process.pid}] ${error.code || ERROR_CODES.SERVER_CLOSE_FAILED} | ${error.message}`
      );
      process.exit(1);
    }
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = {
  startWorker,
};
