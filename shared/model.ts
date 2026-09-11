// Domain model shared by server and client. Pure types and validators only:
// no framework or runtime dependencies, no imports from other shared files.

// Everything is scoped by (userId, productId). The product id is the stable
// identity of a product; its display name (productType) is editable and never
// used as a data key.
export interface Scope {
  userId: number;
  productId: number;
}

// Snapshot of one completed cycle (docs/state.md). All amounts are
// quantities stored as integers (minimum unit 1); money is not modeled yet.
export interface StateSnapshot {
  cycle: number;
  inventory: number; // inventory until end of the cycle
  soldTransit: number; // sold but not sent until end of the cycle
  boughtTransit: number; // bought but not received until end of the cycle
  sent: number; // all sent during the cycle
  received: number; // all received during the cycle
  sale: number; // all sold during the cycle
  purchase: number; // all bought during the cycle
}

// The four whole-cycle aggregates fed into the state machine at settlement.
export interface CycleInput {
  sent: number;
  received: number;
  sale: number;
  purchase: number;
}

export const RECORD_KINDS: readonly ["PURCHASE", "SELL", "SEND", "RECEIVE"] = [
  "PURCHASE",
  "SELL",
  "SEND",
  "RECEIVE",
];
export type RecordKind = (typeof RECORD_KINDS)[number];

export function isRecordKind(value: string): value is RecordKind {
  return RECORD_KINDS.some((kind) => kind === value);
}

export function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isValidProductName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 40 &&
    !/\s/.test(value)
  );
}

// ---- live position math (docs/state.md), shared by server decisions and
// the client's live views ----

export interface TransitPosition {
  inventory: number;
  soldTransit: number;
  boughtTransit: number;
}

// Extrapolate a settled snapshot through pending (unsettled) records:
//   receive moves goods into inventory and settles part of the transit;
//   send ships goods out of inventory and settles part of soldTransit;
//   purchase adds to boughtTransit, sell adds to soldTransit.
export function applyPendingToPosition(
  base: TransitPosition,
  pendingByKind: Record<RecordKind, number>,
): TransitPosition {
  let { inventory, soldTransit, boughtTransit } = base;
  for (const kind of RECORD_KINDS) {
    const amount = pendingByKind[kind];
    if (amount === 0) continue;
    switch (kind) {
      case "RECEIVE":
        inventory += amount;
        boughtTransit -= amount;
        break;
      case "SEND":
        inventory -= amount;
        soldTransit -= amount;
        break;
      case "PURCHASE":
        boughtTransit += amount;
        break;
      case "SELL":
        soldTransit += amount;
        break;
    }
  }
  return { inventory, soldTransit, boughtTransit };
}

export function availableOf(position: TransitPosition): number {
  return position.inventory + position.boughtTransit - position.soldTransit;
}
