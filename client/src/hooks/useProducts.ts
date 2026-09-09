import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api.ts";
import type { ProductItem } from "../lib/types.ts";

export interface ProductsState {
  products: ProductItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useProducts(): ProductsState {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProducts(await api.listProducts());
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { products, loading, error, reload };
}
