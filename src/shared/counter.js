const { COUNTER_BYTES } = require("../config");

function createCounterBuffer() {
  return new SharedArrayBuffer(COUNTER_BYTES);
}

function createCounterView(buffer) {
  return new Int32Array(buffer);
}

function incrementCounter(counterView) {
  return Atomics.add(counterView, 0, 1) + 1;
}

function readCounter(counterView) {
  return Atomics.load(counterView, 0);
}

module.exports = {
  createCounterBuffer,
  createCounterView,
  incrementCounter,
  readCounter,
};
