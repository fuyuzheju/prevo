import { Link } from "react-router-dom";
import { Check, Package, Settings2 } from "lucide-react";
import type { ProductItem } from "../lib/types.ts";
import { cn } from "./ui.tsx";

type SidebarMode = "check" | "single" | "none";

export interface ProductSidebarProps {
  products: readonly ProductItem[];
  loading?: boolean;
  mode: SidebarMode;
  checked?: ReadonlySet<number>;
  selected?: number | null;
  onToggle?: (productId: number, next: boolean) => void;
  onToggleAll?: (next: boolean) => void;
  onSelect?: (productId: number | null) => void;
}

function Checkbox({ on, small }: { on: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border transition-colors",
        small ? "size-3.5 rounded" : "size-4",
        on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent",
      )}
    >
      <Check className={small ? "size-2.5" : "size-3"} strokeWidth={3.5} />
    </span>
  );
}

export function ProductSidebar({
  products,
  loading,
  mode,
  checked,
  selected,
  onToggle,
  onToggleAll,
  onSelect,
}: ProductSidebarProps) {
  const allChecked = products.length > 0 && products.every((p) => checked?.has(p.id));

  const chipRow = (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 lg:hidden">
      {mode === "none" ? null : products.length > 1 && mode === "check" && onToggleAll ? (
        <button
          type="button"
          onClick={() => onToggleAll(!allChecked)}
          className="shrink-0 rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
        >
          {allChecked ? "清空" : "全选"}
        </button>
      ) : null}
      {products.map((product) => {
        const active = mode === "check" ? checked?.has(product.id) : selected === product.id;
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => {
              if (mode === "check") onToggle?.(product.id, !active);
              else onSelect?.(active ? null : product.id);
            }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-300",
            )}
          >
            {mode === "check" ? (
              <Checkbox on={!!active} small />
            ) : mode === "single" ? (
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  active ? "bg-white" : "bg-slate-300",
                )}
              />
            ) : null}
            {product.productType}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {chipRow}
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Package className="size-4 text-blue-600" />
              我的商品
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-500">
              {loading ? "…" : products.length}
            </span>
          </div>
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto p-2">
            {mode === "check" && products.length > 1 && onToggleAll && (
              <li className="flex justify-end pb-1 pr-1">
                <button
                  type="button"
                  onClick={() => onToggleAll(!allChecked)}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  {allChecked ? "清空全部" : "全选"}
                </button>
              </li>
            )}
            {products.length === 0 && !loading && (
              <li className="px-2 py-6 text-center text-xs text-slate-400">还没有商品</li>
            )}
            {products.map((product) => {
              const active =
                mode === "check" ? checked?.has(product.id) : selected === product.id;
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === "check") onToggle?.(product.id, !active);
                      else onSelect?.(active ? null : product.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                    )}
                    title={product.productType}
                  >
                    {mode === "check" ? (
                      <Checkbox on={!!active} />
                    ) : mode === "single" ? (
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          active ? "bg-blue-600" : "border border-slate-300",
                        )}
                      />
                    ) : null}
                    <span className="truncate">{product.productType}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 p-2">
            <Link
              to="/products"
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <Settings2 className="size-4" />
              管理商品
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
