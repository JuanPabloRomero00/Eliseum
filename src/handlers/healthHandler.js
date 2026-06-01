const { HTTP_STATUS } = require("../utils/constants");
const { json } = require("../utils/helpers");

function createHealthHandler({ getTotalCount, getLocalCount }) {
  return function healthHandler(_request, response) {
    json(response, HTTP_STATUS.OK, {
      status: "ok",
      pid: process.pid,
      localCount: getLocalCount(),
      totalCount: getTotalCount(),
    });
  };
}

module.exports = {
  createHealthHandler,
};
