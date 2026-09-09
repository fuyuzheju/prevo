import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CheckCircle2,
  PackageCheck,
  RefreshCw,
  Wallet,
} from "lucide-react";
import * as api from "../lib/api.ts";
import type { RecordEntry, StateSnapshot } from "../lib/types.ts";
import { computeLiveStatus } from "../lib/status.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import { RecordBadge } from "../components/RecordBadge.tsx";
import { Card, CenteredSpinner, InlineMessage, cn } from "../components/ui.tsx";
import { formatDateTime } from "../lib/format.ts";

interface ProductResult {
  productId: number;
  name: string;
  latest: StateSnapshot | null;
  records: RecordEntry[];
  error: string | null;
  loading: boolean;
}

export function QueryPage() {
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [results, setResults] = useState<Record<number, ProductResult>>({});

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
      setChecked(next ? new Set(products.map((p) => p.id)) : new Set());
    },
    [products],
  );

  const selectedIds = useMemo(
    () => products.map((p) => p.id).filter((id) => checked.has(id)),
    [products, checked],
  );

  const loadProduct = useCallback(async (productId: number) => {
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
  }, [products]);

  useEffect(() => {
    for (const productId of selectedIds) {
      void loadProduct(productId);
    }
  }, [selectedIds, loadProduct]);

  const selectedResults = selectedIds
    .map((id) => results[id])
    .filter((r): r is ProductResult => Boolean(r));

  const mergedFeed = useMemo(() => {
    const rows = selectedResults
      .flatMap((r) => r.records.map((record) => ({ name: r.name, record })))
      .sort((a, b) => {
        if (a.record.createdAt !== b.record.createdAt) {
          return a.record.createdAt < b.record.createdAt ? 1 : -1;
        }
        return b.record.id - a.record.id;
      });
    return rows;
  }, [selectedResults]);

  const anyLoading = selectedResults.some((r) => r.loading);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar
        products={products}
        loading={productsLoading}
        mode="check"
        checked={checked}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">查询数据</h1>
          <p className="mt-1 text-sm text-slate-500">
            勾选商品查看实时状态与完整流水，可多选合并查看。
          </p>
        </div>

        {productsError && <InlineMessage tone="error">{productsError}</InlineMessage>}
        {!productsLoading && products.length === 0 && !productsError && (
          <Card className="p-10 text-center">
            <Boxes className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">还没有商品</p>
            <p className="mt-1 text-sm text-slate-400">先去「商品管理」添加商品种类吧。</p>
          </Card>
        )}

        {selectedIds.length === 0 && products.length > 0 && (
          <Card className="p-10 text-center">
            <CheckCircle2 className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">在左侧勾选商品开始查询</p>
            <p className="mt-1 text-sm text-slate-400">
              勾选后可多选，多个商品的数据会合并成一张流水表。
            </p>
          </Card>
        )}

        {selectedIds.length > 0 && (
          <>
            {anyLoading && <CenteredSpinner label="加载商品数据…" />}
            <div className={cn("grid gap-4", selectedResults.length > 1 && "sm:grid-cols-2")}>
              {selectedResults.map((result) => (
                <ProductCard key={result.productId} result={result} onRetry={() => void loadProduct(result.productId)} />
              ))}
            </div>

            <Card>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">
                  流水记录
                  <span className="ml-2 text-sm font-normal tabular-nums text-slate-400">
                    {mergedFeed.length} 条
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    for (const productId of selectedIds) void loadProduct(productId);
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  <RefreshCw className="size-3" /> 刷新
                </button>
              </div>
              {mergedFeed.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">
                  {anyLoading ? "加载中…" : "勾选商品还没有任何记录"}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-400">
                        <th className="px-5 py-2.5 text-left font-medium">时间</th>
                        <th className="px-4 py-2.5 text-left font-medium">商品</th>
                        <th className="px-4 py-2.5 text-left font-medium">类型</th>
                        <th className="px-4 py-2.5 text-left font-medium">周期</th>
                        <th className="px-5 py-2.5 text-right font-medium">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mergedFeed.map(({ name, record }) => (
                        <tr key={record.id} className="border-t border-slate-100 text-slate-600 hover:bg-slate-50">
                          <td className="px-5 py-3 tabular-nums whitespace-nowrap">
                            {formatDateTime(record.createdAt)}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-800">{name}</td>
                          <td className="px-4 py-3">
                            <RecordBadge kind={record.kind} />
                          </td>
                          <td className="px-4 py-3">
                            {record.cycle === null ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                本周期
                              </span>
                            ) : (
                              <span className="text-xs tabular-nums text-slate-400">
                                第 {record.cycle} 期
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {record.amount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function ProductCard({
  result,
  onRetry,
}: {
  result: ProductResult;
  onRetry: () => void;
}) {
  const live = computeLiveStatus(result.latest, result.records);
  const settledCycles = result.latest?.cycle ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
        <p className="font-semibold text-slate-900">{result.name}</p>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            已结算 {settledCycles} 期
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
            本周期 {live.pendingCount} 笔
          </span>
        </div>
      </div>
      {result.error && (
        <div className="px-5 py-3">
          <InlineMessage tone="error">
            <span className="flex items-center justify-between gap-2">
              {result.error}
              <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
                重试
              </button>
            </span>
          </InlineMessage>
        </div>
      )}
      {!result.error && (
        <>
          <div className="px-5 py-4">
            <p className="text-xs text-slate-400">当前库存</p>
            <p className="mt-0.5 text-3xl font-bold tabular-nums text-slate-900">
              {live.inventory}
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
            <StatTile icon={Wallet} label="可用量" value={live.available} accent />
            <StatTile icon={ArrowDownToLine} label="已售未发" value={live.soldTransit} />
            <StatTile icon={ArrowUpFromLine} label="采购在途" value={live.boughtTransit} />
          </div>
          <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-5 py-2 text-xs text-slate-400">
            <PackageCheck className="size-3.5 shrink-0" />
            已结算快照 + 本周期未结算流水推算的实时值
          </div>
        </>
      )}
    </Card>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="px-3 py-3 text-center">
      <p className={cn("flex items-center justify-center gap-1 text-xs", accent ? "text-blue-600" : "text-slate-400")}>
        <Icon className="size-3" />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          accent ? "text-blue-600" : "text-slate-800",
        )}
      >
        {value}
      </p>
    </div>
  );
}
