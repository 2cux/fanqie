const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const window = {
  requestAnimationFrame() {},
  cancelAnimationFrame() {},
  performance: { now: () => 0 },
};
window.window = window;
const context = vm.createContext(window);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../js/focus-motion.js"), "utf8"),
  context,
);

const { FocusMotionController, STATE_RATES, easeInOutCubic } =
  context.FocusCoreMotion;

test("running and paused use clearly separated motion rates", () => {
  assert.ok(STATE_RATES.running.core > STATE_RATES.idle.core);
  assert.ok(STATE_RATES.idle.core > STATE_RATES.paused.core);
  assert.ok(STATE_RATES.running.ambient > STATE_RATES.paused.ambient);
});

test("motion rate changes interpolate without a step", () => {
  const frames = [];
  const animation = {
    animationName: "particle-orbit",
    playbackRate: 0.38,
    updatePlaybackRate(rate) {
      this.playbackRate = rate;
      frames.push(rate);
    },
  };
  let callback;
  const controller = new FocusMotionController(
    { getAnimations: () => [animation] },
    {
      duration: 1000,
      now: () => 0,
      requestFrame: (next) => {
        callback = next;
        return 1;
      },
      cancelFrame() {},
    },
  );

  controller.setState("running");
  callback(0);
  callback(500);
  callback(1000);

  assert.equal(frames[0], STATE_RATES.paused.core);
  assert.ok(frames[1] > frames[0]);
  assert.ok(frames[1] < STATE_RATES.running.core);
  assert.equal(frames[2], STATE_RATES.running.core);
});

test("transition easing is continuous and bounded", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.ok(easeInOutCubic(0.49) < easeInOutCubic(0.51));
});

test("does not start an animation frame when there are no managed animations", () => {
  let frameRequests = 0;
  const controller = new FocusMotionController(
    { getAnimations: () => [] },
    {
      requestFrame: () => {
        frameRequests += 1;
        return 1;
      },
      cancelFrame() {},
    },
  );

  controller.setState("running");

  assert.equal(frameRequests, 0);
  assert.equal(controller.frameId, null);
});

test("does not refresh when managed animations already use the target rate", () => {
  let frameRequests = 0;
  const animation = {
    animationName: "particle-orbit",
    playbackRate: STATE_RATES.running.core,
  };
  const controller = new FocusMotionController(
    { getAnimations: () => [animation] },
    {
      requestFrame: () => {
        frameRequests += 1;
        return 1;
      },
      cancelFrame() {},
    },
  );

  controller.setState("running");
  controller.setState("running");

  assert.equal(frameRequests, 0);
  assert.equal(controller.frameId, null);
});

test("a replacement transition cancels the pending frame and invalidates its callback", () => {
  const callbacks = [];
  const cancelledFrames = [];
  const animation = {
    animationName: "particle-orbit",
    playbackRate: STATE_RATES.idle.core,
    updatePlaybackRate(rate) {
      this.playbackRate = rate;
    },
  };
  const controller = new FocusMotionController(
    { getAnimations: () => [animation] },
    {
      duration: 1000,
      now: () => 0,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    },
  );

  controller.setState("running");
  const staleCallback = callbacks[0];
  controller.setState("paused");
  const requestsBeforeStaleTick = callbacks.length;
  staleCallback(500);

  assert.deepEqual(cancelledFrames, [1]);
  assert.equal(callbacks.length, requestsBeforeStaleTick);
});

test("destroy cancels the pending frame and prevents stale callbacks from continuing", () => {
  const callbacks = [];
  const cancelledFrames = [];
  const animation = {
    animationName: "particle-orbit",
    playbackRate: STATE_RATES.idle.core,
  };
  const controller = new FocusMotionController(
    { getAnimations: () => [animation] },
    {
      duration: 1000,
      now: () => 0,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    },
  );

  controller.setState("running");
  const staleCallback = callbacks[0];
  controller.destroy();
  staleCallback(500);

  assert.deepEqual(cancelledFrames, [1]);
  assert.equal(callbacks.length, 1);
  assert.equal(controller.frameId, null);
  assert.equal(controller.state, null);
});
