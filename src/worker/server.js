const http = require("node:http");
const { handleError } = require("../middlewares/errorHandler");
const { logRequest } = require("../middlewares/logger");
const { ERROR_CODES } = require("../utils/constants");
const { createAppError } = require("../utils/helpers");

function createServer({ routeRequest }) {
  return http.createServer(async (request, response) => {
    try {
      logRequest(request);
      await routeRequest(request, response);
    } catch (error) {
      handleError(
        response,
        error.code
          ? error
          : createAppError({
              code: ERROR_CODES.ROUTE_EXECUTION_FAILED,
              message: "Route execution failed",
              details: `${request.method} ${request.url}`,
              cause: error,
            })
      );
    }
  });
}

module.exports = {
  createServer,
};
