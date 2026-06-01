const { spawn } = require("node:child_process");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const INGEST_REQUESTS = 500;
const HEALTH_REQUESTS = 25;
const CHAOS_REQUESTS = 12;

async function requestJson(url) {
  const startedAt = Date.now();
  const response = await fetch(url);
  const body = await response.json();

  return {
    status: response.status,
    body,
    durationMs: Date.now() - startedAt,
  };
}

async function waitForHealthcheck() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const healthcheck = await requestJson(`${BASE_URL}/health`);

      if (healthcheck.status === 200) {
        return healthcheck;
      }
    } catch (_error) {
      await delay(200);
    }
  }

  throw new Error("Server did not become ready in time");
}

async function waitForExpectedTotalCount(expectedCount) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const healthcheck = await requestJson(`${BASE_URL}/health`);

    if (healthcheck.body.totalCount === expectedCount) {
      return healthcheck;
    }

    await delay(100);
  }

  throw new Error(`Global count did not reach ${expectedCount} in time`);
}

async function runLoadTest() {
  const ingestRequests = Array.from({ length: INGEST_REQUESTS }, (_, index) =>
    requestJson(`${BASE_URL}/ingest?id=${index + 1}`)
  );

  const healthRequests = Array.from({ length: HEALTH_REQUESTS }, () =>
    requestJson(`${BASE_URL}/health`)
  );

  const [ingestResults, healthResults] = await Promise.all([
    Promise.all(ingestRequests),
    Promise.all(healthRequests),
  ]);

  const finalHealthcheck = await waitForExpectedTotalCount(INGEST_REQUESTS);
  const maxHealthLatency = Math.max(...healthResults.map((item) => item.durationMs));
  const successfulIngests = ingestResults.filter((item) => item.status === 200).length;

  console.log(`ingest ok: ${successfulIngests}/${INGEST_REQUESTS}`);
  console.log(`health max latency: ${maxHealthLatency}ms`);
  console.log(`final health payload: ${JSON.stringify(finalHealthcheck.body)}`);

  if (successfulIngests !== INGEST_REQUESTS) {
    throw new Error("Not all ingest requests completed successfully");
  }

  if (finalHealthcheck.body.totalCount !== INGEST_REQUESTS) {
    throw new Error(
      `Expected totalCount=${INGEST_REQUESTS}, received ${finalHealthcheck.body.totalCount}`
    );
  }
}

async function runChaosDrill() {
  const chaosResults = await Promise.all(
    Array.from({ length: CHAOS_REQUESTS }, () => requestJson(`${BASE_URL}/chaos`))
  );

  await delay(300);

  const finalHealthcheck = await requestJson(`${BASE_URL}/health`);
  const uniqueWorkers = new Set(chaosResults.map((item) => item.body.pid));

  console.log(
    `chaos drill: ${chaosResults.length} probes across ${uniqueWorkers.size} workers`
  );
  console.log(`health after chaos: ${JSON.stringify(finalHealthcheck.body)}`);
}

async function main() {
  const appPath = path.join(__dirname, "..", "src", "app.js");
  const serverProcess = spawn(process.execPath, [appPath], {
    stdio: "inherit",
  });

  try {
    await waitForHealthcheck();
    await runLoadTest();
    await runChaosDrill();
  } finally {
    serverProcess.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
