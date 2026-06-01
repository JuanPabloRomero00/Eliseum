const path = require("node:path");
const { Worker } = require("node:worker_threads");

function createIngestionThread(counterBuffer, onMessage) {
  const worker = new Worker(path.join(__dirname, "ingestionWorker.js"), {
    workerData: { counterBuffer },
  });

  if (onMessage) {
    worker.on("message", onMessage);
  }

  return worker;
}

module.exports = {
  createIngestionThread,
};
