const cluster = require("node:cluster");
const { randomUUID } = require("node:crypto");
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
  const pendingGlobalCountAcks = new Map();
  const pendingTotalCountReads = new Map();
  const shouldCrashThisLifecycle = shouldSimulateCrash(
    SIMULATED_CRASH_PROBABILITY
  );

  const ingestionService = createIngestionService({
    onGlobalIncrement(payload) {
      if (!process.send) {
        totalCount = payload.localCount;
        return Promise.resolve(totalCount);
      }

      return new Promise((resolve, reject) => {
        const requestId = randomUUID();
        pendingGlobalCountAcks.set(requestId, { resolve, reject });

        try {
          process.send({
            type: "increment",
            payload: {
              ...payload,
              requestId,
            },
          });
        } catch (error) {
          pendingGlobalCountAcks.delete(requestId);
          reject(error);
        }
      });
    },
  });

  function resolveGlobalCountAck(message) {
    const pendingAck = pendingGlobalCountAcks.get(message.payload?.requestId);

    if (!pendingAck) {
      return false;
    }

    if (typeof message.payload?.totalCount !== "number") {
      pendingGlobalCountAcks.delete(message.payload.requestId);
      pendingAck.reject(
        new Error("Master increment ack did not include a numeric totalCount")
      );
      return true;
    }

    totalCount = message.payload.totalCount;
    pendingGlobalCountAcks.delete(message.payload.requestId);
    pendingAck.resolve(totalCount);
    return true;
  }

  function resolveTotalCountRead(message) {
    const pendingRead = pendingTotalCountReads.get(message.payload?.requestId);

    if (!pendingRead) {
      return false;
    }

    if (typeof message.payload?.totalCount !== "number") {
      pendingTotalCountReads.delete(message.payload.requestId);
      pendingRead.reject(
        new Error("Master total-count ack did not include a numeric totalCount")
      );
      return true;
    }

    totalCount = message.payload.totalCount;
    pendingTotalCountReads.delete(message.payload.requestId);
    pendingRead.resolve(totalCount);
    return true;
  }

  function readTotalCount() {
    if (!process.send) {
      return Promise.resolve(totalCount);
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      pendingTotalCountReads.set(requestId, { resolve, reject });

      try {
        process.send({
          type: "read-total-count",
          payload: { requestId },
        });
      } catch (error) {
        pendingTotalCountReads.delete(requestId);
        reject(error);
      }
    });
  }

  process.on("message", (message) => {
    if (!message || typeof message !== "object") {
      console.error(
        `[worker:${process.pid}] ${ERROR_CODES.INVALID_CLUSTER_MESSAGE} | ignored non-object IPC message`
      );
      return;
    }

    if (message.type === "increment-ack") {
      resolveGlobalCountAck(message);
      return;
    }

    if (message.type === "total-count-ack") {
      resolveTotalCountRead(message);
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

  process.on("disconnect", () => {
    for (const pendingAck of pendingGlobalCountAcks.values()) {
      pendingAck.reject(new Error("Master IPC channel disconnected"));
    }

    for (const pendingRead of pendingTotalCountReads.values()) {
      pendingRead.reject(new Error("Master IPC channel disconnected"));
    }

    pendingGlobalCountAcks.clear();
    pendingTotalCountReads.clear();
  });

  const healthHandler = createHealthHandler({
    getTotalCount: () => readTotalCount(),
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
  const listenOptions = cluster.isWorker
    ? { port: PORT }
    : { host: HOST, port: PORT };

  server.listen(listenOptions, () => {
    console.log(
      `[worker:${process.pid}] listening on http://${HOST}:${PORT} | mode=${cluster.isWorker ? "cluster" : "single"} | crash-armed=${shouldCrashThisLifecycle ? "yes" : "no"}`
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
