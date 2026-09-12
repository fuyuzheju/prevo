import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api.ts";
import type { ProductItem, RecordEntry, StateSnapshot } from "../lib/types.ts";

export interface ProductState {
  productId: number;
  name: string;
  latest: StateSnapshot | null;
  records: RecordEntry[];
  error: string | null;
  loading: boolean;
}

export interface ProductStates {
  results: Record<number, ProductState>;
  load: (productId: number) => Promise<void>;
}

// Loads the latest settled snapshot plus the ledger for every selected product,
// keyed by product id. Callers turn that into a live position with
// computeLiveStatus (lib/status.ts).
export function useProductStates(
  products: readonly ProductItem[],
  selectedIds: readonly number[],
): ProductStates {
  const [results, setResults] = useState<Record<number, ProductState>>({});

  const load = useCallback(
    async (productId: number) => {
      // always seed a complete placeholder first so renders never see a
      // half-built entry (records must be an array even while loading)
      const product = products.find((p) => p.id === productId);
      const name = product?.productType ?? "";
      setResults((prev) => {
        const existing = prev[productId];
        return {
          ...prev,
          [productId]: existing
            ? { ...existing, loading: true }
            : { productId, name, latest: null, records: [], error: null, loading: true },
        };
      });
      try {
        const [latest, records] = await Promise.all([
          api.getLatestState(productId),
          api.listRecords(productId),
        ]);
        setResults((prev) => ({
          ...prev,
          [productId]: { productId, name, latest, records, error: null, loading: false },
        }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [productId]: {
            productId,
            name,
            latest: prev[productId]?.latest ?? null,
            records: prev[productId]?.records ?? [],
            error: api.errorMessage(err),
            loading: false,
          },
        }));
      }
    },
    [products],
  );

  useEffect(() => {
    for (const productId of selectedIds) {
      void load(productId);
    }
  }, [selectedIds, load]);

  return { results, load };
}
