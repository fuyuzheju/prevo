import { db } from "../db.js";
import { ApiError } from "../errors.js";
import { advanceCycle } from "./stateMachine.js";
import {
  isRecordKind,
  type CycleInput,
  type RecordKind,
  type Scope,
} from "../../../shared/model.ts";
import { isQuantity } from "../../../shared/quantity.ts";
import { addLocalDays } from "../../../shared/date.ts";
import type { Prisma } from "../../generated/prisma/client.js";

// Records land on the current (pending) cycle of the scope. Settlement folds
// pending records into a new state machine snapshot and marks the records
// with that cycle; records are kept forever (the ledger). Settlement is
// driven exclusively by the daily job (see the section at the bottom).

interface SummaryDb {
  cycleState: Prisma.CycleStateDelegate;
  scopeRecord: Prisma.ScopeRecordDelegate;
}

function scopeWhere(scope: Scope) {
  return { userId: scope.userId, productId: scope.productId };
}

export async function addRecord(
  scope: Scope,
  kind: RecordKind,
  amount: number,
  client: SummaryDb = db,
): Promise<void> {
  if (!isQuantity(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amount must be an integer number of 1/1000 units");
  }
  await client.scopeRecord.create({ data: { ...scopeWhere(scope), kind, amount } });
}


// purchase returns false instead of throwing on an invalid amount, so the
// caller can react to a rejected purchase bill. The raw body value is passed
// through as unknown because 0 is valid now, so "invalid" can no longer be
// represented by a sentinel amount.
export async function purchase(
  scope: Scope,
  amount: unknown,
  client: SummaryDb = db,
): Promise<boolean> {
  if (!isQuantity(amount)) return false;
  await addRecord(scope, "PURCHASE", amount, client);
  return true;
}

export async function sell(scope: Scope, amount: number): Promise<void> {
  await addRecord(scope, "SELL", amount);
}

export async function send(scope: Scope, amount: number): Promise<void> {
  await addRecord(scope, "SEND", amount);
}

export async function receive(scope: Scope, amount: number): Promise<void> {
  await addRecord(scope, "RECEIVE", amount);
}

const KIND_TO_INPUT: Record<RecordKind, keyof CycleInput> = {
  SELL: "sale",
  PURCHASE: "purchase",
  SEND: "sent",
  RECEIVE: "received",
};

export interface ScopeRecordEntry {
  id: number;
  kind: RecordKind;
  amount: number;
  cycle: number | null;
  createdAt: Date;
}

// The full ledger of the scope, newest first. cycle is null while the record
// is still pending; otherwise it names the cycle the record was folded into.
export async function listRecords(
  scope: Scope,
  client: SummaryDb = db,
): Promise<ScopeRecordEntry[]> {
  const rows = await client.scopeRecord.findMany({
    where: scopeWhere(scope),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, kind: true, amount: true, cycle: true, createdAt: true },
  });
  return rows.filter((row): row is typeof row & { kind: RecordKind } => isRecordKind(row.kind));
}

// ---------------------------------------------------------------------------
// Automated settlement (the daily cycle-close job). The core primitive is
// generic over time: it folds pending records created BEFORE a cutoff into one
// cycle, so a later change of the cycle period only touches the scheduler,
// never this folding logic or the data model.
// ---------------------------------------------------------------------------


// Fold every pending record of the scope with createdAt < cutoff into one new
// cycle. Idempotent: settled records carry a cycle and are never folded again.
// Returns 1 when a cycle was created, 0 otherwise.
async function foldPendingBefore(
  tx: SummaryDb,
  scope: Scope,
  cutoff: Date,
): Promise<number> {
  const rows = await tx.scopeRecord.findMany({
    where: { ...scopeWhere(scope), cycle: null, createdAt: { lt: cutoff } },
    select: { id: true, kind: true, amount: true },
  });
  if (rows.length === 0) return 0;
  const input: CycleInput = { sale: 0, purchase: 0, sent: 0, received: 0 };
  for (const row of rows) {
    if (isRecordKind(row.kind)) {
      input[KIND_TO_INPUT[row.kind]] += row.amount;
    }
  }
  const snapshot = await advanceCycle(scope, input, tx);
  await tx.scopeRecord.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: { cycle: snapshot.cycle },
  });
  return 1;
}

export type SettleClient = SummaryDb & {
  $transaction?: (fn: (tx: SummaryDb) => Promise<number>) => Promise<number>;
};

function withTransaction(
  client: SettleClient,
  run: (tx: SummaryDb) => Promise<number>,
): Promise<number> {
  return client.$transaction ? client.$transaction(run) : run(client);
}

// Generic primitive: settle the pending records created before `cutoff` as one
// cycle. Returns 1 when a cycle was created, 0 otherwise.
export function settlePendingBefore(
  scope: Scope,
  cutoff: Date,
  client: SettleClient = db,
): Promise<number> {
  return withTransaction(client, (tx) => foldPendingBefore(tx, scope, cutoff));
}

// Daily settlement: fold pending records per local calendar day, oldest day
// first, each day becoming its own cycle. Days without records produce no
// cycle, records created "today" (at or after today's local midnight) stay
// pending for the next run. Returns the number of cycles created.
export function settlePendingByDay(
  scope: Scope,
  client: SettleClient = db,
): Promise<number> {
  const run = async (tx: SummaryDb): Promise<number> => {
    const rows = await tx.scopeRecord.findMany({
      where: { ...scopeWhere(scope), cycle: null },
      select: { createdAt: true },
    });
    if (rows.length === 0) return 0;
    let earliest: Date | undefined;
    for (const row of rows) {
      if (earliest === undefined || row.createdAt < earliest) earliest = row.createdAt;
    }
    if (earliest === undefined) return 0;
    const todayStart = addLocalDays(new Date(), 0); // today's local midnight
    let created = 0;
    for (
      let cutoff = addLocalDays(earliest, 1);
      cutoff <= todayStart;
      cutoff = addLocalDays(cutoff, 1)
    ) {
      created += await foldPendingBefore(tx, scope, cutoff);
    }
    return created;
  };
  return withTransaction(client, run);
}
