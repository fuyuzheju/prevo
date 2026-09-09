// Domain model shared by server and client. Pure types and validators only:
// no framework or runtime dependencies, no imports from other shared files.

// Everything is scoped by (userId, productType). Product management itself
// lives above this layer (see docs/struc.md).
export interface Scope {
  userId: number;
  productType: string;
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

// The four whole-cycle aggregates fed into the state machine at summarize().
export interface CycleInput {
  sent: number;
  received: number;
  sale: number;
  purchase: number;
}

export const RECORD_KINDS = ["PURCHASE", "SELL", "SEND", "RECEIVE"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
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
