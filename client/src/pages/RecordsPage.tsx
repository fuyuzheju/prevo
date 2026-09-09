import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ClipboardPlus,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import * as api from "../lib/api.ts";
import type { RecordEntry, RecordKind } from "../lib/types.ts";
import { sumPendingByKind } from "../lib/status.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import { RecordBadge } from "../components/RecordBadge.tsx";
import {
  Button,
  Card,
  Field,
  InlineMessage,
  Input,
  cn,
} from "../components/ui.tsx";

const KIND_LABEL: Record<RecordKind, string> = {
  PURCHASE: "购买",
  SELL: "出售",
  RECEIVE: "收到",
  SEND: "发出",
};

const KIND_DESC: Record<RecordKind, string> = {
  PURCHASE: "采购了货（记账，尚未到货）",
  SELL: "卖出了货（记账，尚未发出）",
  RECEIVE: "采购的货到货了，增加库存",
  SEND: "卖出的货寄出了，减少库存",
};

const KIND_ICON: Record<RecordKind, LucideIcon> = {
  PURCHASE: PackagePlus,
  SELL: PackageMinus,
  RECEIVE: PackageCheck,
  SEND: Send,
};

const KIND_STYLE: Record<RecordKind, { active: string; iconBg: string }> = {
  PURCHASE: { active: "border-blue-600 bg-blue-50 text-blue-700", iconBg: "bg-blue-100 text-blue-700" },
  SELL: { active: "border-sky-600 bg-sky-50 text-sky-700", iconBg: "bg-sky-100 text-sky-700" },
  RECEIVE: { active: "border-teal-600 bg-teal-50 text-teal-700", iconBg: "bg-teal-100 text-teal-700" },
  SEND: { active: "border-indigo-600 bg-indigo-50 text-indigo-700", iconBg: "bg-indigo-100 text-indigo-700" },
};

const ORDER: RecordKind[] = ["PURCHASE", "SELL", "RECEIVE", "SEND"];

interface AddedItem {
  id: number;
  kind: RecordKind;
  amount: number;
}

export function RecordsPage() {
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const [selected, setSelected] = useState<number | null>(null);
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const [kind, setKind] = useState<RecordKind>("PURCHASE");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedItem[]>([]);

  const pending = sumPendingByKind(records);

  const loadRecords = useCallback(async (productId: number) => {
    setRecordsError(null);
    try {
      setRecords(await api.listRecords(productId));
    } catch (err) {
      setRecordsError(api.errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (selected) void loadRecords(selected);
    else setRecords([]);
  }, [selected, loadRecords]);

  const handleSelect = (next: number | null) => {
    setSelected(next);
    setRecords([]); // avoid showing the previous product's data while loading
    setRecordsError(null);
    setError(null);
    setAdded([]);
    setAmount("");
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError("数量必须是大于 0 的整数");
      return;
    }
    setBusy(true);
    try {
      const ok = await api.addRecord(selected, kind, value);
      if (!ok) {
        setError("数量必须是大于 0 的整数");
        return;
      }
      setAdded((prev) => [{ id: Date.now(), kind, amount: value }, ...prev].slice(0, 8));
      setAmount("");
      await loadRecords(selected);
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const product = products.find((p) => p.id === selected) ?? null;
  const settledCycles = records.reduce(
    (max, record) => (record.cycle !== null && record.cycle > max ? record.cycle : max),
    0,
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar
        products={products}
        loading={productsLoading}
        mode="single"
        selected={selected}
        onSelect={handleSelect}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">添加记录</h1>
          <p className="mt-1 text-sm text-slate-500">
            在左侧选择一个商品，为它录入本周期账单。
          </p>
        </div>

        {productsError && <InlineMessage tone="error">{productsError}</InlineMessage>}
        {!productsLoading && products.length === 0 && !productsError && (
          <Card className="p-10 text-center">
            <PackagePlus className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">还没有商品</p>
            <p className="mt-1 text-sm text-slate-400">先去「商品管理」添加商品种类吧。</p>
          </Card>
        )}

        {products.length > 0 && selected === null && (
          <Card className="p-10 text-center">
            <CheckCircle2 className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">在左侧选择一个商品</p>
            <p className="mt-1 text-sm text-slate-400">选择后即可开始添加购买 / 出售 / 收到 / 发出记录。</p>
          </Card>
        )}

        {product && selected !== null && (
          <>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold text-slate-900">{product.productType}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  已结算 {settledCycles} 期
                </span>
              </div>

              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                    本周期未结算
                  </span>
                  <span className="text-xs font-normal text-slate-400">共 {pending.count} 笔</span>
                </p>
                {recordsError ? (
                  <div className="mt-2">
                    <InlineMessage tone="error">{recordsError}</InlineMessage>
                  </div>
                ) : pending.count === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">还没有未结算记录，周期结算将由服务端统一调度。</p>
                ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ORDER.map((k) => (
                      <div key={k} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                        <p className="text-xs text-slate-400">{KIND_LABEL[k]}</p>
                        <p className="mt-0.5 font-semibold tabular-nums text-slate-800">
                          {pending.byKind[k]}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5 sm:p-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-slate-700">记录类型</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ORDER.map((k) => {
                      const Icon = KIND_ICON[k];
                      const active = kind === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setKind(k)}
                          aria-pressed={active}
                          className={cn(
                            "rounded-xl border p-3 text-left transition-colors",
                            active
                              ? KIND_STYLE[k].active + " shadow-sm"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                          )}
                        >
                          <span
                            className={cn(
                              "mb-2 flex size-8 items-center justify-center rounded-lg",
                              active ? KIND_STYLE[k].iconBg : "bg-slate-100 text-slate-500",
                            )}
                          >
                            <Icon className="size-4" />
                          </span>
                          <span className="block text-sm font-semibold">{KIND_LABEL[k]}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
                            {KIND_DESC[k]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <Field label="数量" hint="正整数，最小单位 1">
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="例如：50"
                      className="max-w-xs"
                      autoFocus
                    />
                    <Button type="submit" loading={busy} className="shrink-0 px-6">
                      <ClipboardPlus className="size-4" />
                      添加
                    </Button>
                  </div>
                </Field>
                {error && <InlineMessage tone="error">{error}</InlineMessage>}
              </form>
            </Card>

            {added.length > 0 && (
              <Card>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <h2 className="text-sm font-semibold text-slate-700">本次已添加</h2>
                  <button
                    type="button"
                    onClick={() => setAdded([])}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                  >
                    <Undo2 className="size-3" /> 清空
                  </button>
                </div>
                <ul className="divide-y divide-slate-100 px-5 py-1">
                  {added.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      <RecordBadge kind={item.kind} />
                      <span className="flex-1 text-slate-400">{KIND_DESC[item.kind]}</span>
                      <span className="font-semibold tabular-nums text-slate-800">{item.amount}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <ArrowDownToLine className="size-3.5" />
              收到货物 +库存 / 发出货物 −库存；
              <ArrowUpFromLine className="ml-1 size-3.5" />
              购买 +在途、出售 +已售未发（在「查询数据」可看实时推算）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
