const cluster = require("node:cluster");
const { startMaster } = require("./master");
const { startWorker } = require("../worker");

function startCluster() {
  if (cluster.isPrimary) {
    cluster.schedulingPolicy = cluster.SCHED_RR;
    startMaster();
    return;
  }

  startWorker();
}

module.exports = {
  startCluster,
};
