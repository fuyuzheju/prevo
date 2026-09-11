import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calculator,
  ClipboardPlus,
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
import { Button, Card, CenteredSpinner, InlineMessage, cn } from "../components/ui.tsx";

const fmtNum = new Intl.NumberFormat("zh-CN");

// Model branches the predictor can report (deployment spec §4.3). WMA84 is the
// production model; every other branch is a cold-start fallback whose forecast
// is far less trustworthy, so the UI has to tell them apart.
const PRODUCTION_MODEL = "WMA_84";
const MODEL_LABELS: Readonly<Record<string, string>> = {
  WMA_84: "WMA84",
  MA_56_FALLBACK: "MA56 降级",
  MA_28_FALLBACK: "MA28 降级",
  FULL_MEAN_FALLBACK: "全历史均值降级",
  ALL_ZERO: "无销量",
};

interface ModelInfo {
  label: string;
  tone: string;
  degraded: boolean;
}

// A branch we do not recognise (a swapped-in predict_core) is shown verbatim
// rather than guessed at, so a new model id can never be silently mislabelled.
function modelInfo(method: string): ModelInfo {
  if (method === PRODUCTION_MODEL) {
    return { label: MODEL_LABELS[method] ?? method, tone: "bg-blue-50 text-blue-600", degraded: false };
  }
  const label = MODEL_LABELS[method];
  if (label === undefined) {
    return { label: method, tone: "bg-slate-100 text-slate-500", degraded: false };
  }
  return {
    label,
    tone: method === "ALL_ZERO" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700",
    degraded: true,
  };
}

// Why the forecast fell back, spelled out for the user, or null when the
// production model ran.
function degradedNotice(model: ModelInfo, method: string, windowDays: number): string | null {
  if (!model.degraded) return null;
  if (method === "ALL_ZERO") return "这个商品还没有任何销量记录，预测结果为 0。";
  return `历史销量不足 84 天，本次改用近 ${windowDays} 天的均值估算，可信度低于常规预测。`;
}

export function PredictPage() {
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const navigate = useNavigate();
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

  // draft a purchase record on the add-record page at the suggested quantity
  function draftPurchase() {
    if (selected === null) return;
    navigate(`/records?productId=${selected}&amount=${prediction?.suggestedAmount ?? 0}`);
  }

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
            <PurchaseDecisionCard prediction={prediction} onDraftPurchase={draftPurchase} />
          </>
        )}
      </div>
    </div>
  );
}

function PurchaseDecisionCard({
  prediction,
  onDraftPurchase,
}: {
  prediction: SalesPrediction;
  onDraftPurchase: () => void;
}) {
  const { forecast } = prediction;
  const model = modelInfo(forecast.method);
  const notice = degradedNotice(model, forecast.method, forecast.windowDays);
  // Only WMA84 averages with non-uniform weights; the fallback branches average
  // evenly, so calling every branch a plain 日均 would misstate what was computed.
  const weighted = forecast.method === PRODUCTION_MODEL;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
          <ShieldCheck className="size-4 text-blue-600" />
          采购决策
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", model.tone)}>
            {model.label}
          </span>
        </h2>
        <span className="text-xs text-slate-400">
          预测：近 {forecast.windowDays} 天{weighted ? "加权" : ""}日均
          {fmtNum.format(forecast.dailyRate)} × 14 天
        </span>
      </div>
      {notice !== null && (
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-700">
          {notice}
        </p>
      )}
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
          action={
            prediction.suggestedAmount > 0 ? (
              <Button onClick={onDraftPurchase} className="mt-3 w-full">
                <ClipboardPlus className="size-4" />
                起草采购单
              </Button>
            ) : undefined
          }
        />
      </div>
    </Card>
  );
}

function DecisionTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  action,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  hint: string;
  tone: string;
  action?: ReactNode;
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
      {action}
    </div>
  );
}
