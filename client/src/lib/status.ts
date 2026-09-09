import type { RecordEntry, RecordKind, StateSnapshot } from "./types.ts";

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
// the pending (unsettled) records, mirroring the state machine formulas:
//   receive/send move inventory; purchase adds to transit, receive settles it;
//   sell adds to soldTransit, send settles it.
export function computeLiveStatus(
  snapshot: StateSnapshot | null,
  records: readonly RecordEntry[],
): LiveStatus {
  const pending = pendingOf(records);
  let inventory = snapshot?.inventory ?? 0;
  let soldTransit = snapshot?.soldTransit ?? 0;
  let boughtTransit = snapshot?.boughtTransit ?? 0;

  for (const record of pending) {
    switch (record.kind) {
      case "RECEIVE":
        inventory += record.amount;
        boughtTransit -= record.amount;
        break;
      case "SEND":
        inventory -= record.amount;
        soldTransit -= record.amount;
        break;
      case "PURCHASE":
        boughtTransit += record.amount;
        break;
      case "SELL":
        soldTransit += record.amount;
        break;
    }
  }

  return {
    inventory,
    soldTransit,
    boughtTransit,
    available: inventory + boughtTransit - soldTransit,
    pendingCount: pending.length,
  };
}

export function sumPendingByKind(records: readonly RecordEntry[]): PendingTotals {
  const pending = pendingOf(records);
  const byKind: Record<RecordKind, number> = { PURCHASE: 0, SELL: 0, SEND: 0, RECEIVE: 0 };
  for (const record of pending) {
    byKind[record.kind] += record.amount;
  }
  return { count: pending.length, byKind };
}
