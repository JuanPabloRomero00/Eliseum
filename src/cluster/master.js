const cluster = require("node:cluster");
const { CLUSTER_WORKERS } = require("../config");
const { buildWorkerBar } = require("../utils/helpers");

function startMaster() {
  let totalCount = 0;
  let restartCount = 0;
  let isShuttingDown = false;
  const processedIngestIds = new Set();

  function logClusterEvent(label, details) {
    const activeWorkers = Object.values(cluster.workers).filter(Boolean).length;
    const workerBar = buildWorkerBar(activeWorkers, CLUSTER_WORKERS);

    console.log(
      `[master:${process.pid}] ${workerBar} ${label} | active=${activeWorkers}/${CLUSTER_WORKERS} | restarts=${restartCount} | total=${totalCount}${details ? ` | ${details}` : ""}`
    );
  }

  function broadcastTotalCount() {
    for (const worker of Object.values(cluster.workers)) {
      if (!worker?.isConnected()) {
        continue;
      }

      try {
        worker.send({
          type: "global-count",
          payload: { totalCount },
        });
      } catch (_error) {
      }
    }
  }

  function forkWorker() {
    const worker = cluster.fork();

    worker.on("online", () => {
      logClusterEvent("UP   +", `worker=${worker.process.pid}`);
      broadcastTotalCount();
    });

    worker.on("message", (message) => {
      if (!message || typeof message !== "object") {
        logClusterEvent("WARN  !", `worker=${worker.process.pid} invalid IPC payload`);
        return;
      }

      if (message.type === "read-total-count") {
        if (message.payload?.requestId && worker.isConnected()) {
          try {
            worker.send({
              type: "total-count-ack",
              payload: {
                requestId: message.payload.requestId,
                totalCount,
              },
            });
          } catch (_error) {
          }
        }

        return;
      }

      if (message.type !== "increment") {
        return;
      }

      const ingestId = message.payload?.ingestId;
      const isKnownIngestId = Number.isInteger(ingestId) && ingestId >= 0;

      if (!isKnownIngestId || !processedIngestIds.has(ingestId)) {
        totalCount += 1;

        if (isKnownIngestId) {
          processedIngestIds.add(ingestId);
        }
      }

      if (message.payload?.requestId && worker.isConnected()) {
        try {
          worker.send({
            type: "increment-ack",
            payload: {
              requestId: message.payload.requestId,
              totalCount,
            },
          });
        } catch (_error) {
        }
      }

      broadcastTotalCount();
    });

    worker.on("error", (error) => {
      logClusterEvent(
        "ERROR !",
        `worker=${worker.process.pid} ipc=${error.message}`
      );
    });

    return worker;
  }

  for (let index = 0; index < CLUSTER_WORKERS; index += 1) {
    forkWorker();
  }

  cluster.on("exit", (worker, code, signal) => {
    if (isShuttingDown) {
      logClusterEvent(
        "STOP  -",
        `worker=${worker.process.pid} code=${code} signal=${signal || "none"}`
      );
      return;
    }

    restartCount += 1;
    logClusterEvent(
      "DOWN x",
      `worker=${worker.process.pid} code=${code} signal=${signal || "none"}`
    );

    forkWorker();
    broadcastTotalCount();
  });

  logClusterEvent("BOOT  ", "cluster starting");

  function shutdown() {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logClusterEvent("HALT  ", "cluster shutting down");

    for (const worker of Object.values(cluster.workers)) {
      if (!worker) {
        continue;
      }

      worker.disconnect();

      if (!worker.process.killed) {
        worker.process.kill("SIGTERM");
      }
    }

    cluster.disconnect(() => {
      process.exit(0);
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = {
  startMaster,
};
