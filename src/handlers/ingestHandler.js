const { HTTP_STATUS, ERROR_CODES } = require("../utils/constants");
const { parseIngestId, json, createAppError } = require("../utils/helpers");

function createIngestHandler({ ingestionService }) {
  return async function ingestHandler(request, response) {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const ingestId = parseIngestId(requestUrl.searchParams);

    if (ingestId === null) {
      throw createAppError({
        code: ERROR_CODES.INVALID_INGEST_ID,
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: "Invalid ingest request",
        details: "Query param 'id' must be a non-negative integer",
      });
    }

    const result = await ingestionService.ingest(ingestId);

    json(response, HTTP_STATUS.OK, result);
  };
}

module.exports = {
  createIngestHandler,
};
