import { db, type DbClient } from "../db.js";
import { ApiError } from "../errors.js";
import type { CycleInput, Scope, StateSnapshot } from "../../../shared/model.ts";
import type { CycleState } from "../../generated/prisma/client.js";

// Pure transition per docs/state.md. prev is the snapshot of the previous
// cycle (undefined means the very first cycle, everything starts at zero).
export function nextCycleState(
  prev: StateSnapshot | undefined,
  input: CycleInput,
): StateSnapshot {
  const p = prev ?? emptySnapshot(0);
  return {
    cycle: p.cycle + 1,
    inventory: p.inventory + input.received - input.sent,
    soldTransit: p.soldTransit + input.sale - input.sent,
    boughtTransit: p.boughtTransit + input.purchase - input.received,
    sent: input.sent,
    received: input.received,
    sale: input.sale,
    purchase: input.purchase,
  };
}

function emptySnapshot(cycle: number): StateSnapshot {
  return {
    cycle,
    inventory: 0,
    soldTransit: 0,
    boughtTransit: 0,
    sent: 0,
    received: 0,
    sale: 0,
    purchase: 0,
  };
}

// available = inventory + bought - sold (docs/state.md)
export function computeAvailable(s: StateSnapshot): number {
  return s.inventory + s.boughtTransit - s.soldTransit;
}

function toSnapshot(row: CycleState): StateSnapshot {
  return {
    cycle: row.cycle,
    inventory: row.inventory,
    soldTransit: row.soldTransit,
    boughtTransit: row.boughtTransit,
    sent: row.sent,
    received: row.received,
    sale: row.sale,
    purchase: row.purchase,
  };
}

function scopeWhere(scope: Scope) {
  return { userId: scope.userId, productId: scope.productId };
}

type StateClient = Pick<DbClient, "cycleState">;

export async function getState(
  scope: Scope,
  cycle: number,
  client: StateClient = db,
): Promise<StateSnapshot | null> {
  const row = await client.cycleState.findUnique({
    where: { productId_cycle: { productId: scope.productId, cycle } },
  });
  return row ? toSnapshot(row) : null;
}

export async function getLatestState(
  scope: Scope,
  client: StateClient = db,
): Promise<StateSnapshot | null> {
  const row = await client.cycleState.findFirst({
    where: scopeWhere(scope),
    orderBy: { cycle: "desc" },
  });
  return row ? toSnapshot(row) : null;
}

export async function listStates(
  scope: Scope,
  client: StateClient = db,
): Promise<StateSnapshot[]> {
  const rows = await client.cycleState.findMany({
    where: scopeWhere(scope),
    orderBy: { cycle: "asc" },
  });
  return rows.map(toSnapshot);
}

// Append one more cycle snapshot: the next cycle number follows the latest
// one. The @@unique([productId, cycle]) constraint guards against double
// summarization.
export async function advanceCycle(
  scope: Scope,
  input: CycleInput,
  client: StateClient = db,
): Promise<StateSnapshot> {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value)) {
      throw new ApiError(
        400,
        "INVALID_CYCLE_INPUT",
        `cycle input "${key}" must be an integer number of 1/1000 units`,
      );
    }
  }
  const latest = await getLatestState(scope, client);
  const snapshot = nextCycleState(latest ?? undefined, input);
  await client.cycleState.create({
    data: { ...scopeWhere(scope), ...snapshot },
  });
  return snapshot;
}
