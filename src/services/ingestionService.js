const { randomUUID } = require("node:crypto");
const { createCounterBuffer, createCounterView } = require("../shared/counter");
const { createIngestionThread } = require("../threads");
const { readCounter } = require("../shared/counter");
const { HTTP_STATUS, ERROR_CODES } = require("../utils/constants");
const { createAppError } = require("../utils/helpers");

function createIngestionService({ onGlobalIncrement }) {
  const counterBuffer = createCounterBuffer();
  const counterView = createCounterView(counterBuffer);
  const pendingRequests = new Map();
  let threadAvailable = true;

  const ingestionThread = createIngestionThread(counterBuffer, (message) => {
    const pendingRequest = pendingRequests.get(message.requestId);

    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(message.requestId);

    if (onGlobalIncrement) {
      onGlobalIncrement({
        pid: process.pid,
        localCount: message.localCount,
      });
    }

    pendingRequest.resolve({
      ingestId: message.ingestId,
      result: message.result,
      localCount: message.localCount,
      sharedCount: message.sharedCount,
    });
  });

  ingestionThread.on("error", (error) => {
    threadAvailable = false;

    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(
        createAppError({
          code: ERROR_CODES.INGESTION_THREAD_CRASHED,
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
          message: "Ingestion worker thread crashed",
          details: "The current worker can no longer process ingest requests",
          cause: error,
        })
      );
    }

    pendingRequests.clear();
  });

  ingestionThread.on("exit", (exitCode) => {
    if (exitCode === 0) {
      return;
    }

    threadAvailable = false;

    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(
        createAppError({
          code: ERROR_CODES.INGESTION_THREAD_UNAVAILABLE,
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
          message: "Ingestion worker thread became unavailable",
          details: `Thread exited with code ${exitCode}`,
        })
      );
    }

    pendingRequests.clear();
  });

  function ingest(ingestId) {
    if (!threadAvailable) {
      return Promise.reject(
        createAppError({
          code: ERROR_CODES.INGESTION_THREAD_UNAVAILABLE,
          statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
          message: "Ingestion service is temporarily unavailable",
          details: "The worker thread is not running",
        })
      );
    }

    return new Promise((resolve, reject) => {
      const requestId = randomUUID();

      pendingRequests.set(requestId, { resolve, reject });

      try {
        ingestionThread.postMessage({ requestId, ingestId });
      } catch (error) {
        pendingRequests.delete(requestId);
        reject(
          createAppError({
            code: ERROR_CODES.INGESTION_THREAD_MESSAGE_FAILED,
            statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
            message: "Could not dispatch ingest task to worker thread",
            details: `requestId=${requestId} ingestId=${ingestId}`,
            cause: error,
          })
        );
      }
    });
  }

  function getLocalCount() {
    return readCounter(counterView);
  }

  function dispose() {
    return ingestionThread.terminate();
  }

  return {
    ingest,
    getLocalCount,
    dispose,
  };
}

module.exports = {
  createIngestionService,
};
