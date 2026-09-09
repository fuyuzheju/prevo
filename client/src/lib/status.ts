import type { RecordEntry, RecordKind, StateSnapshot } from "./types.ts";
import { applyPendingToPosition, availableOf } from "../../../shared/model.ts";

export interface LiveStatus {
  inventory: number;
  soldTransit: number;
  boughtTransit: number;
  available: number;
  pendingCount: number;
}

export interface PendingTotals {
  count: number;
  byKind: Record<RecordKind, number>;
}

export function pendingOf(records: readonly RecordEntry[]): RecordEntry[] {
  return records.filter((record) => record.cycle === null);
}

// Live position of a scope: the latest settled snapshot extrapolated through
// the pending (unsettled) records, mirroring the state machine formulas.
export function computeLiveStatus(
  snapshot: StateSnapshot | null,
  records: readonly RecordEntry[],
): LiveStatus {
  const pending = pendingOf(records);
  const byKind = sumPendingByKind(records).byKind;
  const base = {
    inventory: snapshot?.inventory ?? 0,
    soldTransit: snapshot?.soldTransit ?? 0,
    boughtTransit: snapshot?.boughtTransit ?? 0,
  };
  const position = applyPendingToPosition(base, byKind);
  return { ...position, available: availableOf(position), pendingCount: pending.length };
}

export function sumPendingByKind(records: readonly RecordEntry[]): PendingTotals {
  const pending = pendingOf(records);
  const byKind: Record<RecordKind, number> = { PURCHASE: 0, SELL: 0, SEND: 0, RECEIVE: 0 };
  for (const record of pending) {
    byKind[record.kind] += record.amount;
  }
  return { count: pending.length, byKind };
}
