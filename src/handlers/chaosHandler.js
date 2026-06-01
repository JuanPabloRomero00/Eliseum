const { HTTP_STATUS } = require("../utils/constants");
const { json } = require("../utils/helpers");

function createChaosHandler({ crashProbability, isCrashArmed, hasSimulatedCrash }) {
  return function chaosHandler(_request, response) {
    json(response, HTTP_STATUS.OK, {
      status: isCrashArmed() && !hasSimulatedCrash() ? "armed" : "safe",
      pid: process.pid,
      crashProbability,
      willCrashAfterResponse: isCrashArmed() && !hasSimulatedCrash(),
    });
  };
}

module.exports = {
  createChaosHandler,
};
