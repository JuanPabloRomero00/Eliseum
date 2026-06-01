const { HTTP_STATUS } = require("../utils/constants");
const { json } = require("../utils/helpers");

function handleError(response, error) {
  const statusCode = error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const code = error.code || "INTERNAL_SERVER_ERROR";
  const message = error.message || "Unexpected server error";

  console.error(
    `[worker:${process.pid}] request failed | code=${code} | message=${message}`
  );

  json(response, statusCode, {
    error: {
      code,
      message,
      details: error.details || null,
    },
  });
}

module.exports = {
  handleError,
};
