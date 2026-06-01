const { spawn } = require("node:child_process");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const http = require("node:http");

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const INGEST_REQUESTS = 500;
const HEALTH_REQUESTS = 25;
const CHAOS_REQUESTS = 12;
const USE_EXISTING_SERVER = process.env.USE_EXISTING_SERVER === "1";
const INTERLEAVED_CHAOS = process.env.INTERLEAVED_CHAOS === "1";

async function detectExistingServer() {
  try {
    const healthcheck = await requestJson(`${BASE_URL}/health`);
    return healthcheck.status === 200;
  } catch (_error) {
    return false;
  }
}

async function requestJson(url) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      target,
      {
        method: "GET",
        agent: false,
        headers: {
          Connection: "close",
        },
      },
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode,
              body: JSON.parse(rawBody),
              durationMs: Date.now() - startedAt,
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function isTransientRequestError(error) {
  return (
    error?.code === "ECONNRESET" ||
    error?.code === "ECONNREFUSED" ||
    error?.code === "EPIPE" ||
    error?.code === "UND_ERR_SOCKET"
  );
}

function isRetryableResponse(response) {
  return response.status >= 500;
}

async function requestJsonWithRetry(url, retries = 5, retryDelayMs = 100) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await requestJson(url);

      if (!isRetryableResponse(response) || attempt === retries) {
        return response;
      }

      lastError = new Error(`Retryable response status ${response.status}`);
      await delay(retryDelayMs);
    } catch (error) {
      lastError = error;

      if (!isTransientRequestError(error) || attempt === retries) {
        throw error;
      }

      await delay(retryDelayMs);
    }
  }

  throw lastError;
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
  let lastObservedTotalCount = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const healthcheck = await requestJson(`${BASE_URL}/health`);
    lastObservedTotalCount = healthcheck.body.totalCount;

    if (healthcheck.body.totalCount === expectedCount) {
      return healthcheck;
    }

    await delay(100);
  }

  throw new Error(
    `Global count did not reach ${expectedCount} in time; last observed totalCount=${lastObservedTotalCount}`
  );
}

async function runLoadTest(initialTotalCount) {
  const expectedTotalCount = initialTotalCount + INGEST_REQUESTS;
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

  const finalHealthcheck = await waitForExpectedTotalCount(expectedTotalCount);
  const maxHealthLatency = Math.max(...healthResults.map((item) => item.durationMs));
  const successfulIngests = ingestResults.filter((item) => item.status === 200).length;
  const uniqueIngestWorkers = new Set(ingestResults.map((item) => item.body.pid));
  const ingestCountByWorker = ingestResults.reduce((counts, item) => {
    const workerPid = item.body.pid;
    counts.set(workerPid, (counts.get(workerPid) || 0) + 1);
    return counts;
  }, new Map());
  const ingestDistribution = Array.from(ingestCountByWorker.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([workerPid, count]) => `${workerPid}:${count}`)
    .join(" | ");

  console.log(`ingest ok: ${successfulIngests}/${INGEST_REQUESTS}`);
  console.log(`ingest workers used: ${uniqueIngestWorkers.size}`);
  console.log(`ingest by worker: ${ingestDistribution}`);
  console.log(`total count baseline: ${initialTotalCount}`);
  console.log(`health max latency: ${maxHealthLatency}ms`);
  console.log(`final health payload: ${JSON.stringify(finalHealthcheck.body)}`);

  if (successfulIngests !== INGEST_REQUESTS) {
    throw new Error("Not all ingest requests completed successfully");
  }

  if (finalHealthcheck.body.totalCount !== expectedTotalCount) {
    throw new Error(
      `Expected totalCount=${expectedTotalCount}, received ${finalHealthcheck.body.totalCount}`
    );
  }
}

async function runInterleavedChaosLoadTest(initialTotalCount) {
  const expectedTotalCount = initialTotalCount + INGEST_REQUESTS;
  const ingestSettledResults = Promise.allSettled(
    Array.from({ length: INGEST_REQUESTS }, (_, index) =>
      requestJsonWithRetry(`${BASE_URL}/ingest?id=${index + 1}`)
    )
  );
  const healthSettledResults = Promise.allSettled(
    Array.from({ length: HEALTH_REQUESTS }, () =>
      requestJsonWithRetry(`${BASE_URL}/health`)
    )
  );
  const chaosSettledResults = Promise.allSettled(
    Array.from({ length: CHAOS_REQUESTS }, () =>
      requestJsonWithRetry(`${BASE_URL}/chaos`)
    )
  );

  const [ingestResults, healthResults, chaosResults] = await Promise.all([
    ingestSettledResults,
    healthSettledResults,
    chaosSettledResults,
  ]);

  const successfulIngests = ingestResults
    .filter((item) => item.status === "fulfilled" && item.value.status === 200)
    .map((item) => item.value);
  const failedIngests = ingestResults.filter(
    (item) => item.status === "rejected" || item.value.status !== 200
  );
  const successfulHealthchecks = healthResults
    .filter((item) => item.status === "fulfilled" && item.value.status === 200)
    .map((item) => item.value);
  const failedHealthchecks = healthResults.filter(
    (item) => item.status === "rejected" || item.value.status !== 200
  );
  const successfulChaos = chaosResults
    .filter((item) => item.status === "fulfilled" && item.value.status === 200)
    .map((item) => item.value);
  const failedChaos = chaosResults.filter(
    (item) => item.status === "rejected" || item.value.status !== 200
  );
  const finalHealthcheck = await waitForExpectedTotalCount(expectedTotalCount);
  const maxHealthLatency =
    successfulHealthchecks.length > 0
      ? Math.max(...successfulHealthchecks.map((item) => item.durationMs))
      : 0;
  const uniqueIngestWorkers = new Set(successfulIngests.map((item) => item.body.pid));
  const ingestCountByWorker = successfulIngests.reduce((counts, item) => {
    const workerPid = item.body.pid;
    counts.set(workerPid, (counts.get(workerPid) || 0) + 1);
    return counts;
  }, new Map());
  const ingestDistribution = Array.from(ingestCountByWorker.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([workerPid, count]) => `${workerPid}:${count}`)
    .join(" | ");
  const armedResponses = successfulChaos.filter(
    (item) => item.body.willCrashAfterResponse === true
  );

  console.log(`mixed mode: ingest ok ${successfulIngests.length}/${INGEST_REQUESTS}`);
  console.log(`mixed mode: ingest failed ${failedIngests.length}`);
  console.log(`mixed mode: ingest workers used ${uniqueIngestWorkers.size}`);
  console.log(`mixed mode: ingest by worker ${ingestDistribution}`);
  console.log(`mixed mode: health ok ${successfulHealthchecks.length}/${HEALTH_REQUESTS}`);
  console.log(`mixed mode: health failed ${failedHealthchecks.length}`);
  console.log(`mixed mode: chaos ok ${successfulChaos.length}/${CHAOS_REQUESTS}`);
  console.log(`mixed mode: chaos failed ${failedChaos.length}`);
  console.log(`mixed mode: chaos armed responses ${armedResponses.length}`);
  console.log(`mixed mode: total count baseline ${initialTotalCount}`);
  console.log(`mixed mode: health max latency ${maxHealthLatency}ms`);
  console.log(`mixed mode: final health payload ${JSON.stringify(finalHealthcheck.body)}`);

  if (successfulIngests.length !== INGEST_REQUESTS) {
    throw new Error(
      `Mixed mode lost ingest requests: ok=${successfulIngests.length} failed=${failedIngests.length}`
    );
  }

  if (finalHealthcheck.body.totalCount !== expectedTotalCount) {
    throw new Error(
      `Expected totalCount=${expectedTotalCount}, received ${finalHealthcheck.body.totalCount}`
    );
  }
}

async function runChaosDrill() {
  const chaosSettledResults = await Promise.allSettled(
    Array.from({ length: CHAOS_REQUESTS }, () => requestJson(`${BASE_URL}/chaos`))
  );
  const chaosResults = chaosSettledResults
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value);
  const chaosFailures = chaosSettledResults.filter((item) => item.status === "rejected");
  const armedResponses = chaosResults.filter(
    (item) => item.body.willCrashAfterResponse === true
  );

  await delay(300);

  const finalHealthcheck = await requestJson(`${BASE_URL}/health`);
  const uniqueWorkers = new Set(chaosResults.map((item) => item.body.pid));

  console.log(
    `chaos drill: ${chaosResults.length} probes across ${uniqueWorkers.size} workers`
  );
  console.log(`chaos armed responses: ${armedResponses.length}`);
  console.log(`chaos transient failures: ${chaosFailures.length}`);
  console.log(`health after chaos: ${JSON.stringify(finalHealthcheck.body)}`);
}

async function main() {
  let serverProcess = null;
  let waitForServerExit = Promise.resolve();
  const existingServerDetected = await detectExistingServer();
  const shouldUseExistingServer = USE_EXISTING_SERVER || existingServerDetected;

  if (shouldUseExistingServer) {
    console.log(
      USE_EXISTING_SERVER
        ? `test mode: using existing server at ${BASE_URL}`
        : `test mode: detected existing server at ${BASE_URL}`
    );
  } else {
    const appPath = path.join(__dirname, "..", "src", "app.js");
    serverProcess = spawn(process.execPath, [appPath], {
      stdio: "inherit",
      env: {
        ...process.env,
        REQUEST_LOGGING_ENABLED: "0",
      },
    });
    console.log(`test mode: started temporary server at ${BASE_URL}`);
    waitForServerExit = new Promise((resolve) => {
      serverProcess.once("exit", resolve);
    });
  }

  try {
    const initialHealthcheck = await waitForHealthcheck();
    if (INTERLEAVED_CHAOS) {
      await runInterleavedChaosLoadTest(initialHealthcheck.body.totalCount || 0);
    } else {
      await runLoadTest(initialHealthcheck.body.totalCount || 0);
      await runChaosDrill();
    }
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await waitForServerExit;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
