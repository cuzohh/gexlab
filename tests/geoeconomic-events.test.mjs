import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficialEventListing, summarizeChannels } from "../src/lib/geoeconomic-events.ts";

test("official event listing keeps only geoeconomic items and classifies their review channels", () => {
  const events = parseOfficialEventListing(`
    <article><time>July 23, 2026</time><a href="/actions/tariffs">USTR Takes Final Action on Semiconductor Tariffs for China</a></article>
    <article><time>July 22, 2026</time><a href="/actions/sanctions">Treasury Announces Sanctions on Iranian Oil Network</a></article>
    <a href="/about">About the agency and its mission</a>
  `, "USTR", "https://ustr.gov/releases");

  assert.equal(events.length, 2);
  assert.deepEqual(events[0].channels, ["trade", "technology"]);
  assert.equal(events[0].status, "effective");
  assert.ok(events[0].tags.includes("China"));
  assert.deepEqual(events[1].channels, ["energy", "fx", "credit"]);
});

test("channel summary reports the event count per review path", () => {
  const events = parseOfficialEventListing(
    `<time>July 23, 2026</time><a href="/x">Export Controls on Semiconductor Technology</a>`,
    "BIS",
    "https://bis.gov/releases",
  );
  const summary = summarizeChannels(events);
  assert.equal(summary.find((item) => item.channel === "technology")?.events, 1);
  assert.equal(summary.find((item) => item.channel === "trade")?.events, 0);
});
