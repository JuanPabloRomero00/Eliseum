const cluster = require("node:cluster");
const { CLUSTER_WORKERS } = require("../config");
const { buildWorkerBar } = require("../utils/helpers");

function startMaster() {
  let totalCount = 0;
  let restartCount = 0;

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
    });

    worker.on("message", (message) => {
      if (!message || typeof message !== "object") {
        logClusterEvent("WARN  !", `worker=${worker.process.pid} invalid IPC payload`);
        return;
      }

      if (message.type !== "increment") {
        return;
      }

      totalCount += 1;
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
    restartCount += 1;
    logClusterEvent(
      "DOWN x",
      `worker=${worker.process.pid} code=${code} signal=${signal || "none"}`
    );

    forkWorker();
    broadcastTotalCount();
  });

  logClusterEvent("BOOT  ", "cluster starting");
}

module.exports = {
  startMaster,
};
