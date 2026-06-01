const { parentPort, workerData } = require("node:worker_threads");
const { runHeavyComputation } = require("../utils/helpers");
const {
  createCounterView,
  incrementCounter,
  readCounter,
} = require("../shared/counter");

const counterView = createCounterView(workerData.counterBuffer);

parentPort.on("message", (message) => {
  const result = runHeavyComputation(message.ingestId);
  const localCount = incrementCounter(counterView);

  parentPort.postMessage({
    requestId: message.requestId,
    ingestId: message.ingestId,
    result,
    localCount,
    sharedCount: readCounter(counterView),
  });
});
