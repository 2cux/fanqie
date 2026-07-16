const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const context = vm.createContext({ Math, Number, Object, Array });
context.window = context;
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, "../js/energy-visual.js"), "utf8"),
  context,
);
const { mapEnergyToVisuals } = context.FocusCoreEnergyVisual;

test("Energy 的视觉信号连续且单调增长", () => {
  const samples = [0, 1, 10, 99, 100, 101, 1_000, 10_000].map((energy) =>
    mapEnergyToVisuals(energy),
  );
  for (const key of ["intensity", "range", "flow", "density"]) {
    assert.equal(samples[0][key], 0);
    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(samples[index][key] > samples[index - 1][key]);
      assert.ok(samples[index][key] < 1);
    }
  }
});

test("Energy 100 附近没有视觉跳变，粒子只会平滑淡入", () => {
  const before = mapEnergyToVisuals(99);
  const at = mapEnergyToVisuals(100);
  const after = mapEnergyToVisuals(101);
  assert.ok(Math.abs(at.intensity - before.intensity) < 0.002);
  assert.ok(Math.abs(after.intensity - at.intensity) < 0.002);
  at.particlePresence.forEach((presence, index) => {
    assert.ok(presence >= before.particlePresence[index]);
    assert.ok(after.particlePresence[index] >= presence);
    assert.ok(presence >= 0 && presence <= 1);
  });
});
