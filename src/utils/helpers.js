const { DEFAULT_INGEST_ID, HEAVY_WORK_BASE } = require("../config");
const { HTTP_STATUS } = require("./constants");

function parseIngestId(searchParams) {
  const rawId = searchParams.get("id");

  if (rawId === null) {
    return DEFAULT_INGEST_ID;
  }

  const parsedId = Number(rawId);

  if (!Number.isInteger(parsedId) || parsedId < 0) {
    return null;
  }

  return parsedId;
}

function runHeavyComputation(ingestId) {
  const iterations = HEAVY_WORK_BASE + ingestId;
  let accumulator = 0;

  for (let index = 0; index < iterations; index += 1) {
    accumulator += (index * (ingestId + 1)) % 97;
  }

  return accumulator;
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function shouldSimulateCrash(probability) {
  return Math.random() < probability;
}

function buildWorkerBar(activeWorkers, expectedWorkers) {
  const online = "#".repeat(activeWorkers);
  const missing = ".".repeat(Math.max(0, expectedWorkers - activeWorkers));

  return `[${online}${missing}]`;
}

function createAppError({
  message,
  code = "INTERNAL_ERROR",
  statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  details,
  cause,
}) {
  const error = new Error(message, cause ? { cause } : undefined);

  error.code = code;
  error.statusCode = statusCode;
  error.details = details;

  return error;
}

module.exports = {
  parseIngestId,
  runHeavyComputation,
  json,
  shouldSimulateCrash,
  buildWorkerBar,
  createAppError,
};
