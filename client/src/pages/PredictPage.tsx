import { useCallback, useEffect, useState } from "react";
import {
  Calculator,
  DatabaseBackup,
  History,
  PackageOpen,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import * as api from "../lib/api.ts";
import type { SalesPrediction } from "../lib/types.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import { SalesChart } from "../components/SalesChart.tsx";
import { Card, CenteredSpinner, InlineMessage, cn } from "../components/ui.tsx";

const fmtNum = new Intl.NumberFormat("zh-CN");

export function PredictPage() {
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const [selected, setSelected] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<SalesPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (productId: number) => {
    setLoading(true);
    setError(null);
    try {
      setPrediction(await api.getPrediction(productId));
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void load(selected);
    else setPrediction(null);
  }, [selected, load]);

  const none = !selected;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar
        products={products}
        loading={productsLoading}
        mode="single"
        selected={selected}
        onSelect={setSelected}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">销量预测</h1>
          <p className="mt-1 text-sm text-slate-500">
            基于历史销量预测未来两周需求，并给出采购建议。历史销量可在「商品管理」页导入。
          </p>
        </div>

        {productsError && <InlineMessage tone="error">{productsError}</InlineMessage>}
        {!productsLoading && products.length === 0 && !productsError && (
          <Card className="p-10 text-center">
            <TrendingUp className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">还没有商品</p>
            <p className="mt-1 text-sm text-slate-400">先去「商品管理」添加商品种类吧。</p>
          </Card>
        )}
        {none && products.length > 0 && (
          <Card className="p-10 text-center">
            <Calculator className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">在左侧选择一个商品</p>
            <p className="mt-1 text-sm text-slate-400">查看它的销量曲线与采购建议。</p>
          </Card>
        )}

        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {loading && <CenteredSpinner label="计算预测…" />}

        {prediction && !loading && (
          <>
            {/* chart */}
            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <History className="size-4 text-blue-600" />
                  每日销量
                </h2>
                <span className="text-xs text-slate-400">
                  滚轮 / 拖拽底部滑块可缩放 · 共 {prediction.series.length} 天
                </span>
              </div>
              {prediction.series.length === 0 ? (
                <p className="py-14 text-center text-sm text-slate-400">
                  还没有销量数据：到「商品管理」导入历史销量，或添加「出售」记录后会自动出现在这里
                </p>
              ) : (
                <SalesChart series={prediction.series} />
              )}
            </Card>

            {/* purchase decision */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
                  <ShieldCheck className="size-4 text-blue-600" />
                  采购决策
                </h2>
                <span className="text-xs text-slate-400">
                  预测：近 {prediction.forecast.windowDays} 天日均
                  {fmtNum.format(prediction.forecast.dailyRate)} × 14 天
                </span>
              </div>
              <div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <DecisionTile
                  icon={Wallet}
                  label="当前可用量"
                  tone="text-slate-900"
                  value={prediction.available}
                  hint="库存 + 在途 − 已售未发"
                />
                <DecisionTile
                  icon={DatabaseBackup}
                  label="安全库存"
                  tone="text-blue-600"
                  value={prediction.safetyStock}
                  hint="预测下两周总销量"
                />
                <DecisionTile
                  icon={ShoppingCart}
                  label="采购建议"
                  tone={prediction.suggestedAmount > 0 ? "text-emerald-600" : "text-slate-400"}
                  value={prediction.suggestedAmount}
                  hint={
                    prediction.suggestedAmount > 0
                      ? prediction.orderMultiple > 1
                        ? `已按起订点 ${prediction.orderMultiple} 向上取整（安全库存 − 可用量的整数倍）`
                        : "建议量 = 安全库存 − 当前可用量"
                      : "库存充足，无需采购"
                  }
                />
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function DecisionTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  hint: string;
  tone: string;
}) {
  return (
    <div className="px-5 py-5">
      <p className="flex items-center gap-1.5 text-sm text-slate-400">
        <Icon className="size-4 text-blue-500" />
        {label}
      </p>
      <p className={cn("mt-2 text-4xl font-bold tabular-nums tracking-tight", tone)}>
        {fmtNum.format(value)}
      </p>
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
        <PackageOpen className="size-3" />
        {hint}
      </p>
    </div>
  );
}
