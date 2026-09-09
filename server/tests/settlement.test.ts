import { describe, expect, it, beforeEach } from "vitest";
import { db } from "../src/db.js";
import {
  msUntilNextSettle,
  parseSettleTime,
  runDailySettlement,
} from "../src/modules/settlement.js";
import { listRecords, settlePendingByDay } from "../src/modules/stateSummary.js";
import { listStates } from "../src/modules/stateMachine.js";
import { createScope, createUser, scopeFor, truncateAll } from "./helpers.js";

describe("parseSettleTime", () => {
  it("defaults to 00:05", () => {
    expect(parseSettleTime(undefined)).toEqual({ hour: 0, minute: 5 });
  });

  it("parses valid times", () => {
    expect(parseSettleTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseSettleTime("9:05")).toEqual({ hour: 9, minute: 5 });
  });

  it("rejects invalid times", () => {
    for (const bad of ["25:00", "9:5", "00:60", "noon", "", "0:0"]) {
      expect(() => parseSettleTime(bad)).toThrow();
    }
  });
});

describe("msUntilNextSettle", () => {
  it("schedules later today when the time has not passed", () => {
    const now = new Date(2026, 8, 8, 10, 0, 0); // 10:00
    const delay = msUntilNextSettle(now, { hour: 10, minute: 30 });
    expect(delay).toBe(30 * 60 * 1000);
  });

  it("schedules tomorrow when the time has passed or is now", () => {
    const now = new Date(2026, 8, 8, 10, 0, 0);
    const passed = msUntilNextSettle(now, { hour: 9, minute: 0 });
    expect(passed).toBe(23 * 60 * 60 * 1000);
    const exactly = msUntilNextSettle(now, { hour: 10, minute: 0 });
    expect(exactly).toBe(24 * 60 * 60 * 1000);
  });
});

async function createRecord(
  scope: { userId: number; productType: string },
  kind: "PURCHASE" | "SELL" | "SEND" | "RECEIVE",
  amount: number,
  createdAt: Date,
) {
  await db.scopeRecord.create({ data: { ...scope, kind, amount, createdAt } });
}

describe("settlePendingByDay", () => {
  beforeEach(truncateAll);

  it("folds pending records into one cycle per local calendar day", async () => {
    const scope = await createScope();
    // two days of activity, dates far enough apart to be tz-safe
    await createRecord(scope, "PURCHASE", 100, new Date(2026, 8, 5, 12, 0));
    await createRecord(scope, "RECEIVE", 40, new Date(2026, 8, 5, 12, 5));
    await createRecord(scope, "SELL", 30, new Date(2026, 8, 6, 12, 0));
    await createRecord(scope, "PURCHASE", 50, new Date(2026, 8, 6, 15, 0));
    await createRecord(scope, "SEND", 20, new Date(2026, 8, 7, 9, 0));

    const created = await settlePendingByDay(scope);
    expect(created).toBe(3);

    const states = await listStates(scope);
    expect(states.map((s) => s.cycle)).toEqual([1, 2, 3]);
    // day 1: purchase 100, receive 40
    expect(states[0]).toMatchObject({ sale: 0, purchase: 100, received: 40, sent: 0, inventory: 40, boughtTransit: 60 });
    // day 2: sell 30, purchase 50
    expect(states[1]).toMatchObject({ sale: 30, purchase: 50, received: 0, sent: 0, soldTransit: 30, boughtTransit: 110, inventory: 40 });
    // day 3: send 20 (ships from inventory and from soldTransit)
    expect(states[2]).toMatchObject({ sent: 20, sale: 0, purchase: 0, inventory: 20, soldTransit: 10, boughtTransit: 110 });

    const records = await listRecords(scope);
    expect(records.map((r) => r.cycle).sort()).toEqual([1, 1, 2, 2, 3]);
  });

  it("never folds a record twice and skips empty days", async () => {
    const scope = await createScope();
    await createRecord(scope, "PURCHASE", 10, new Date(2026, 8, 5, 12, 0));
    expect(await settlePendingByDay(scope)).toBe(1);
    expect(await settlePendingByDay(scope)).toBe(0); // nothing pending anymore
    expect(await listStates(scope)).toHaveLength(1);
  });

  it("leaves records created today pending", async () => {
    const scope = await createScope();
    await createRecord(scope, "SELL", 10, new Date()); // today
    expect(await settlePendingByDay(scope)).toBe(0);
    expect(await listStates(scope)).toHaveLength(0);
  });

  it("isolates scopes", async () => {
    const scope = await createScope();
    await createRecord(scope, "PURCHASE", 10, new Date(2026, 8, 5, 12, 0));
    const other = scopeFor(await createUser("other"), "widget");
    expect(await settlePendingByDay(other)).toBe(0);
    expect(await settlePendingByDay(scope)).toBe(1);
  });
});

describe("runDailySettlement", () => {
  beforeEach(truncateAll);

  it("settles every scope that has pending records", async () => {
    const user = await createUser("owner");
    const a = scopeFor(user, "widget");
    const b = scopeFor(user, "gadget");
    const otherUserScope = scopeFor(await createUser("other"), "widget");
    const empty = scopeFor(user, "spare");
    await createRecord(a, "PURCHASE", 10, new Date(2026, 8, 5, 12, 0));
    await createRecord(b, "SELL", 7, new Date(2026, 8, 5, 12, 0));
    await createRecord(otherUserScope, "RECEIVE", 3, new Date(2026, 8, 5, 12, 0));
    // empty scope has no records

    const cycles = await runDailySettlement();
    expect(cycles).toBe(3);
    expect((await listStates(a))[0]?.cycle).toBe(1);
    expect((await listStates(b))[0]?.cycle).toBe(1);
    expect((await listStates(otherUserScope))[0]?.cycle).toBe(1);
    expect(await listStates(empty)).toEqual([]);
  });
});
