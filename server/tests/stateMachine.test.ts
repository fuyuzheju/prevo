import { describe, expect, it, beforeEach } from "vitest";
import {
  advanceCycle,
  computeAvailable,
  getLatestState,
  getState,
  listStates,
  nextCycleState,
} from "../src/modules/stateMachine.js";
import { ApiError } from "../src/errors.js";
import { createProduct, createScope, createUser, mustDefined, scopeFor, truncateAll } from "./helpers.js";

// Pure transition, per docs/state.md:
//   inventory = inventory[-1] + received - sent
//   soldTransit = soldTransit[-1] + sale - sent
//   boughtTransit = boughtTransit[-1] + purchase - received
describe("nextCycleState (pure)", () => {
  it("computes the first cycle from zero", () => {
    const first = nextCycleState(undefined, {
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });
    expect(first).toEqual({
      cycle: 1,
      inventory: 40,
      soldTransit: 10,
      boughtTransit: 40,
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });
  });

  it("transitions from the previous cycle", () => {
    const first = nextCycleState(undefined, {
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });
    const second = nextCycleState(first, { sent: 0, received: 0, sale: 80, purchase: 50 });
    expect(second).toEqual({
      cycle: 2,
      inventory: 40,
      soldTransit: 90,
      boughtTransit: 90,
      sent: 0,
      received: 0,
      sale: 80,
      purchase: 50,
    });
  });

  it("keeps every input field on the snapshot", () => {
    const s = nextCycleState(undefined, { sent: 5, received: 7, sale: 3, purchase: 9 });
    expect(s.sent).toBe(5);
    expect(s.received).toBe(7);
    expect(s.sale).toBe(3);
    expect(s.purchase).toBe(9);
  });
});

describe("computeAvailable", () => {
  it("available = inventory + bought - sold", () => {
    const s = nextCycleState(undefined, {
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 100,
    });
    expect(computeAvailable(s)).toBe(70);
  });
});

describe("persisted state machine", () => {
  beforeEach(truncateAll);

  it("advanceCycle appends numbered snapshots per scope", async () => {
    const scope = await createScope();
    const s1 = await advanceCycle(scope, { sent: 20, received: 60, sale: 30, purchase: 100 });
    const s2 = await advanceCycle(scope, { sent: 0, received: 0, sale: 80, purchase: 50 });
    expect(s1.cycle).toBe(1);
    expect(s2.cycle).toBe(2);
    expect((await getLatestState(scope))?.cycle).toBe(2);
    const all = await listStates(scope);
    expect(all.map((s) => s.cycle)).toEqual([1, 2]);
    expect(mustDefined(all[1], "second state").inventory).toBe(40);
  });

  it("reads a snapshot by cycle number", async () => {
    const scope = await createScope();
    await advanceCycle(scope, { sent: 20, received: 60, sale: 30, purchase: 100 });
    await advanceCycle(scope, { sent: 0, received: 0, sale: 80, purchase: 50 });
    const c1 = await getState(scope, 1);
    expect(c1?.sale).toBe(30);
    expect(await getState(scope, 1)).not.toBeNull();
    expect(await getState(scope, 99)).toBeNull();
  });

  it("isolates scopes by userId and productId", async () => {
    const owner = await createUser("user-a");
    const a = scopeFor(owner, await createProduct(owner, "widget"));
    const b = scopeFor(owner, await createProduct(owner, "gadget"));
    const other = await createUser("user-b");
    const c = scopeFor(other, await createProduct(other, "widget"));
    await advanceCycle(a, { sent: 0, received: 0, sale: 30, purchase: 100 });
    expect(await listStates(a)).toHaveLength(1);
    expect(await listStates(b)).toHaveLength(0);
    expect(await listStates(c)).toHaveLength(0);
  });
});

describe("input validation at the data layer", () => {
  beforeEach(truncateAll);

  it("rejects negative cycle inputs", async () => {
    const scope = await createScope();
    await expect(
      advanceCycle(scope, { sent: -1, received: 0, sale: 0, purchase: 0 }),
    ).rejects.toThrow(ApiError);
  });
});
