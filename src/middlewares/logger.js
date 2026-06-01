const { REQUEST_LOGGING_ENABLED } = require("../config");

function logRequest(request) {
  if (!REQUEST_LOGGING_ENABLED) {
    return;
  }

  console.log(
    `[worker:${process.pid}] ${request.method} ${request.url} ${new Date().toISOString()}`
  );
}

module.exports = {
  logRequest,
};
