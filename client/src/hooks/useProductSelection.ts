import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductItem } from "../lib/types.ts";

export interface ProductSelection {
  checked: ReadonlySet<number>;
  selectedIds: number[];
  toggle: (productId: number, next: boolean) => void;
  toggleAll: (next: boolean) => void;
}

export function useProductSelection(
  products: readonly ProductItem[],
  options?: { defaultAll?: boolean },
): ProductSelection {
  const defaultAll = options?.defaultAll ?? false;
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  // The default selection applies once, when the product list first arrives:
  // later reloads (after add/edit/delete) must not undo the user's own choices.
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !defaultAll || products.length === 0) return;
    seeded.current = true;
    setChecked(new Set(products.map((product) => product.id)));
  }, [products, defaultAll]);

  const toggle = useCallback((productId: number, next: boolean) => {
    setChecked((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(productId);
      else copy.delete(productId);
      return copy;
    });
  }, []);

  const toggleAll = useCallback(
    (next: boolean) => {
      setChecked(next ? new Set(products.map((product) => product.id)) : new Set());
    },
    [products],
  );

  // Product order, and without ids that are gone from the list (deleted).
  const selectedIds = useMemo(
    () => products.map((product) => product.id).filter((id) => checked.has(id)),
    [products, checked],
  );

  return { checked, selectedIds, toggle, toggleAll };
}
