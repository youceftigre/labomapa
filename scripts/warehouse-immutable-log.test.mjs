/**
 * Unit tests for append-only (immutable) operation log helpers.
 * Mirrors the merge logic used in src/lib/warehouse/engine.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";

function mergeAppendOnly(existing, incoming) {
  const byId = new Map();
  for (const e of existing) byId.set(String(e.id), e);
  for (const e of incoming) {
    const id = String(e.id);
    if (!byId.has(id)) byId.set(id, e);
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

function parseOptionalNonNegInt(raw) {
  if (raw === "" || raw === null || raw === undefined) return { kind: "blank" };
  if (typeof raw === "string" && raw.trim() === "") return { kind: "blank" };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return { kind: "bad" };
  return { kind: "ok", value: n };
}

test("mergeAppendOnly keeps existing entries and never overwrites", () => {
  const existing = [
    { id: "a", ts: 1, qty: 5, type: "out" },
    { id: "b", ts: 2, qty: 3, type: "in" },
  ];
  const incoming = [
    { id: "a", ts: 99, qty: 999, type: "in" }, // must be ignored
    { id: "c", ts: 3, qty: 1, type: "borrow" },
  ];
  const merged = mergeAppendOnly(existing, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((e) => e.id === "a").qty, 5);
  assert.equal(merged.find((e) => e.id === "a").ts, 1);
  assert.ok(merged.some((e) => e.id === "c"));
});

test("mergeAppendOnly is stable when cloud is empty", () => {
  const existing = [{ id: "x", ts: 10, qty: 2, type: "out" }];
  const merged = mergeAppendOnly(existing, []);
  assert.deepEqual(merged, existing);
});

test("mergeAppendOnly sorts by timestamp", () => {
  const merged = mergeAppendOnly(
    [{ id: "b", ts: 20, qty: 1, type: "in" }],
    [{ id: "a", ts: 10, qty: 1, type: "out" }],
  );
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
});

test("duplicate id on append is a no-op", () => {
  const log = [{ id: "1", ts: 1, qty: 1, type: "in", sealed: true }];
  const next = mergeAppendOnly(log, [{ id: "1", ts: 2, qty: 99, type: "out" }]);
  assert.equal(next.length, 1);
  assert.equal(next[0].qty, 1);
  assert.equal(next[0].type, "in");
});

test("blank excel/json qty is not coerced to zero", () => {
  assert.equal(parseOptionalNonNegInt("").kind, "blank");
  assert.equal(parseOptionalNonNegInt(undefined).kind, "blank");
  assert.equal(parseOptionalNonNegInt(0).kind, "ok");
  assert.equal(parseOptionalNonNegInt(-4).kind, "bad");
});
