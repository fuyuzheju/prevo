import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import { ApiError } from "../src/errors.js";
import {
  purchase,
  sell,
  send,
  receive,
  summarize,
  listRecords,
} from "../src/modules/stateSummary.js";
import { getLatestState, listStates } from "../src/modules/stateMachine.js";
import { createScope, createUser, scopeFor, truncateAll } from "./helpers.js";

describe("records within a cycle", () => {
  beforeEach(truncateAll);

  it("adds a purchase record", async () => {
    const scope = await createScope();
    expect(await purchase(scope, 100)).toBe(true);
    const records = await db.scopeRecord.findMany({ where: { userId: scope.userId } });
    expect(records).toHaveLength(1);
    expect(records[0]!.kind).toBe("PURCHASE");
    expect(records[0]!.amount).toBe(100);
  });

  it("purchase returns false for an invalid amount instead of throwing", async () => {
    const scope = await createScope();
    expect(await purchase(scope, 0)).toBe(false);
    expect(await purchase(scope, -5)).toBe(false);
    expect(await purchase(scope, 1.5)).toBe(false);
    expect(await db.scopeRecord.count()).toBe(0);
  });

  it("sell/send/receive throw on invalid amounts", async () => {
    const scope = await createScope();
    for (const op of [sell, send, receive]) {
      await expect(op(scope, 0)).rejects.toBeInstanceOf(ApiError);
      await expect(op(scope, -1)).rejects.toBeInstanceOf(ApiError);
    }
    expect(await db.scopeRecord.count()).toBe(0);
  });
});

describe("summarize", () => {
  beforeEach(truncateAll);

  it("folds the four record kinds into the state machine inputs", async () => {
    const scope = await createScope();
    await purchase(scope, 100);
    await purchase(scope, 20);
    await sell(scope, 30);
    await send(scope, 20);
    await receive(scope, 60);

    const snapshot = await summarize(scope);
    expect(snapshot).toEqual({
      cycle: 1,
      inventory: 40,
      soldTransit: 10,
      boughtTransit: 60,
      sent: 20,
      received: 60,
      sale: 30,
      purchase: 120,
    });
    // records are kept forever, now marked as folded into cycle 1
    const rows = await db.scopeRecord.findMany();
    expect(rows).toHaveLength(5); // 2 purchase + sell + send + receive
    for (const row of rows) expect(row.cycle).toBe(1);
    expect((await listStates(scope))[0]).toEqual(snapshot);
  });

  it("keeps accumulating into the next cycle after a summarize", async () => {
    const scope = await createScope();
    await purchase(scope, 100);
    await receive(scope, 60);
    await summarize(scope);
    await purchase(scope, 50);
    await sell(scope, 80);
    const s2 = await summarize(scope);
    expect(s2?.cycle).toBe(2);
    expect(s2?.inventory).toBe(60);
    expect(s2?.soldTransit).toBe(80);
    expect(s2?.boughtTransit).toBe(90);
    expect(s2?.sale).toBe(80);
  });

  it("is a no-op when the cycle has no records", async () => {
    const scope = await createScope();
    expect(await summarize(scope)).toBeNull();
    expect(await getLatestState(scope)).toBeNull();
  });

  it("never folds a settled record twice", async () => {
    const scope = await createScope();
    await purchase(scope, 100);
    await receive(scope, 60);
    const s1 = await summarize(scope);
    const again = await summarize(scope);
    expect(s1?.cycle).toBe(1);
    expect(again).toBeNull();
    expect((await listStates(scope))).toHaveLength(1);
  });

  it("isolates records by scope", async () => {
    const a = scopeFor(await createUser("user-a"), "widget");
    const b = scopeFor(a.userId, "gadget");
    await purchase(a, 100);
    expect(await summarize(b)).toBeNull();
    expect(await getLatestState(a)).toBeNull();
    expect(await summarize(a)).not.toBeNull();
  });
});

describe("listRecords", () => {
  beforeEach(truncateAll);

  it("returns the full ledger newest first with pending and settled entries", async () => {
    const scope = await createScope();
    await purchase(scope, 100); // settled in cycle 1
    await receive(scope, 60);
    const s1 = await summarize(scope);
    expect(s1?.cycle).toBe(1);
    await sell(scope, 30); // still pending
    await purchase(scope, 20);

    const records = await listRecords(scope);
    expect(records.map((r) => r.kind)).toEqual(["PURCHASE", "SELL", "RECEIVE", "PURCHASE"]);
    expect(records[0]).toMatchObject({ amount: 20, cycle: null });
    expect(records[1]).toMatchObject({ amount: 30, cycle: null });
    expect(records[2]).toMatchObject({ amount: 60, cycle: 1 });
    expect(records[3]).toMatchObject({ amount: 100, cycle: 1 });
    for (const record of records) {
      expect(record.id).toBeTypeOf("number");
      expect(record.createdAt).toBeInstanceOf(Date);
    }
  });

  it("respects scope isolation", async () => {
    const scope = await createScope();
    await purchase(scope, 5);
    const other = scopeFor(await createUser("other"), "widget");
    expect(await listRecords(other)).toEqual([]);
  });
});
