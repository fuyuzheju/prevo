import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api.ts";
import type { ProductItem } from "../lib/types.ts";

export interface ProductsState {
  products: ProductItem[];
  loading: boolean;
  error: string | null;
  // Resolves to the freshly loaded list (empty on failure) so callers can act
  // on products created after their last render.
  reload: () => Promise<ProductItem[]>;
}

export function useProducts(): ProductsState {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<ProductItem[]> => {
    setLoading(true);
    setError(null);
    try {
      const items = await api.listProducts();
      setProducts(items);
      return items;
    } catch (err) {
      setError(api.errorMessage(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { products, loading, error, reload };
}
