function logRequest(request) {
  console.log(
    `[worker:${process.pid}] ${request.method} ${request.url} ${new Date().toISOString()}`
  );
}

module.exports = {
  logRequest,
};
