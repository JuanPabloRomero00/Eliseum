const { HEALTH_PATH, INGEST_PATH, CHAOS_PATH } = require("../config");
const { HTTP_STATUS } = require("../utils/constants");
const { json } = require("../utils/helpers");

function createRoutes({ healthHandler, ingestHandler, chaosHandler }) {
  return async function routeRequest(request, response) {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;

    if (request.method === "GET" && pathname === HEALTH_PATH) {
      healthHandler(request, response);
      return;
    }

    if (request.method === "GET" && pathname === INGEST_PATH) {
      await ingestHandler(request, response);
      return;
    }

    if (request.method === "GET" && pathname === CHAOS_PATH) {
      chaosHandler(request, response);
      return;
    }

    json(response, HTTP_STATUS.NOT_FOUND, {
      error: "Route not found",
    });
  };
}

module.exports = {
  createRoutes,
};
