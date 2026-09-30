import assert from "node:assert/strict";
import test from "node:test";

import { inBatches } from "../src/lib/batch.ts";

test("never runs more than the limit at once", async () => {
  let inFlight = 0;
  let peak = 0;
  await inBatches(Array.from({ length: 20 }, (_, index) => index), 3, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return value;
  });
  assert.ok(peak <= 3, `expected at most 3 concurrent, saw ${peak}`);
  assert.ok(peak > 1, "the whole point is that some run in parallel");
});

test("results keep the order of the input, not the order they finish", async () => {
  // The first item takes longest, so completion order is the reverse of input.
  const out = await inBatches([30, 20, 10, 0], 4, async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return delay;
  });
  assert.deepEqual(out, [30, 20, 10, 0]);
});

test("every item is visited exactly once", async () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  const seen = [];
  await inBatches(items, 4, async (value) => { seen.push(value); return value; });
  assert.equal(seen.length, items.length);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test("an empty list does no work and a limit below one still progresses", async () => {
  assert.deepEqual(await inBatches([], 3, async () => "x"), []);
  assert.deepEqual(await inBatches([1, 2], 0, async (value) => value * 2), [2, 4]);
});
