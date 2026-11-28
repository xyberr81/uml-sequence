// The subset of bun:test's `expect` that er.test.ts uses, on node:assert, so the
// tests read as they did in ratchet.
import assert from "node:assert/strict";

/** Bun's toMatchObject: every key of `expected` matches, recursively; arrays match by length and item. */
function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matches(actual[i], e));
  }
  return Object.entries(expected).every(([k, v]) => k in actual && matches((actual as Record<string, unknown>)[k], v));
}

const contains = (actual: unknown, item: unknown): boolean =>
  typeof actual === "string" ? actual.includes(item as string) : (actual as unknown[]).some((x) => Object.is(x, item));

export function expect(actual: unknown) {
  const n = actual as number;
  return {
    toBe: (e: unknown) => assert.ok(Object.is(actual, e), `expected ${String(actual)} to be ${String(e)}`),
    toEqual: (e: unknown) => assert.deepStrictEqual(actual, e),
    toContain: (e: unknown) => assert.ok(contains(actual, e), `expected to contain ${JSON.stringify(e)}`),
    toMatch: (re: RegExp) => assert.match(actual as string, re),
    toMatchObject: (e: unknown) => assert.ok(matches(actual, e), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(e)}`),
    toHaveLength: (len: number) => assert.equal((actual as { length: number }).length, len),
    toBeDefined: () => assert.notEqual(actual, undefined),
    toBeGreaterThan: (e: number) => assert.ok(n > e, `expected ${n} > ${e}`),
    toBeGreaterThanOrEqual: (e: number) => assert.ok(n >= e, `expected ${n} >= ${e}`),
    toBeLessThan: (e: number) => assert.ok(n < e, `expected ${n} < ${e}`),
    not: {
      toBe: (e: unknown) => assert.ok(!Object.is(actual, e), `expected not to be ${String(e)}`),
      toBeNull: () => assert.notEqual(actual, null),
      toContain: (e: unknown) => assert.ok(!contains(actual, e), `expected not to contain ${JSON.stringify(e)}`),
      toMatch: (re: RegExp) => assert.doesNotMatch(actual as string, re),
    },
  };
}
