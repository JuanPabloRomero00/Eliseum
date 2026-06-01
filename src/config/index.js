const os = require("node:os");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const AVAILABLE_CPUS = os.cpus().length;
const CLUSTER_WORKERS = Math.max(1, Math.floor(AVAILABLE_CPUS / 2));
const COUNTER_BYTES = 4;
const HEALTH_PATH = "/health";
const INGEST_PATH = "/ingest";
const CHAOS_PATH = "/chaos";
const DEFAULT_INGEST_ID = 0;
const HEAVY_WORK_BASE = 150_000;
const SIMULATED_CRASH_PROBABILITY = Number(
  process.env.SIMULATED_CRASH_PROBABILITY || 0.25
);

module.exports = {
  PORT,
  HOST,
  AVAILABLE_CPUS,
  CLUSTER_WORKERS,
  COUNTER_BYTES,
  HEALTH_PATH,
  INGEST_PATH,
  CHAOS_PATH,
  DEFAULT_INGEST_ID,
  HEAVY_WORK_BASE,
  SIMULATED_CRASH_PROBABILITY,
};
