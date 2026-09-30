import assert from "node:assert/strict";
import test from "node:test";

import { readTopology, sampleTopology } from "../src/lib/options-topology.ts";

test("topology reading distinguishes clustered and bifurcated fields", () => {
  assert.equal(readTopology([
    { strike: 1, value: 4 },
    { strike: 2, value: 2 },
    { strike: 3, value: 1 },
  ]).label, "Positive cluster");

  assert.equal(readTopology([
    { strike: 1, value: -4 },
    { strike: 2, value: 2 },
    { strike: 3, value: -1 },
    { strike: 4, value: 3 },
  ]).label, "Bifurcated");
});

test("topology sampling preserves the endpoints of a dense field", () => {
  const sampled = sampleTopology(
    Array.from({ length: 101 }, (_, index) => ({ strike: index, value: index - 50 })),
    9,
  );

  assert.equal(sampled.length, 9);
  assert.equal(sampled[0].strike, 0);
  assert.equal(sampled.at(-1).strike, 100);
});
