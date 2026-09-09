// Re-exports of the shared domain model plus client-side UI additions.
import type { RecordKind } from "../../../shared/model.ts";
export type { CycleInput, RecordKind, Scope, StateSnapshot } from "../../../shared/model.ts";

export interface AuthUser {
  id: number;
  username: string;
  createdAt: string;
}

// One ledger entry of a scope. cycle is null while the record is still
// pending; after a server-side settlement it names the folded cycle.
export interface RecordEntry {
  id: number;
  kind: RecordKind;
  amount: number;
  cycle: number | null;
  createdAt: string;
}

export interface ProductItem {
  productType: string;
  createdAt: string;
}
