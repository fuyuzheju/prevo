import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { isValidProductName } from "../../../shared/model.ts";
import * as api from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  InlineMessage,
  Input,
} from "../components/ui.tsx";

export function ProductsPage() {
  const { products, loading, error, reload } = useProducts();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAddOk(null);
    const trimmed = name.trim();
    if (!isValidProductName(trimmed)) {
      setAddError("商品名称需为 1-40 个字符，且不能包含空白");
      return;
    }
    if (products.some((p) => p.productType === trimmed)) {
      setAddError("已有同名商品");
      return;
    }
    setAdding(true);
    try {
      await api.createProduct(trimmed);
      setName("");
      setAddOk(`已添加商品「${trimmed}」`);
      await reload();
    } catch (err) {
      setAddError(api.errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProduct(pendingDelete);
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setDeleteError(api.errorMessage(err));
      setDeleting(false);
    }
  }

  const target = products.find((p) => p.productType === pendingDelete) ?? null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar products={products} loading={loading} mode="none" />

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">商品管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理你的商品种类，之后可在这里补充商品详细信息。</p>
        </div>

        {error && <InlineMessage tone="error">{error}</InlineMessage>}

        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <PackagePlus className="size-4 text-blue-600" />
            新增商品
          </h2>
          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <Field label="商品名称" hint="1-40 个字符，不含空白；之后可补充详细信息">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：夏季T恤"
                  className="max-w-xs"
                />
                <Button type="submit" loading={adding} className="shrink-0">
                  <Plus className="size-4" />
                  添加
                </Button>
              </div>
            </Field>
            {addError && <InlineMessage tone="error">{addError}</InlineMessage>}
            {addOk && <InlineMessage tone="success">{addOk}</InlineMessage>}
          </form>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">
              商品列表
              <span className="ml-2 text-sm font-normal tabular-nums text-slate-400">
                {products.length} 种
              </span>
            </h2>
          </div>
          {products.length === 0 && !loading ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              还没有商品，用上方表单添加第一个吧
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {products.map((product) => (
                <li key={product.productType} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-semibold text-blue-600">
                    {(product.productType[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{product.productType}</p>
                    <p className="text-xs tabular-nums text-slate-400">
                      创建于 {formatDate(product.createdAt)}
                    </p>
                  </div>
                  <Link
                    to="/records"
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    添加记录
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(product.productType)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50"
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {pendingDelete && target && (
        <ConfirmDialog
          title={`删除商品「${target.productType}」？`}
          confirmLabel="永久删除"
          danger
          busy={deleting}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteError(null);
          }}
          onConfirm={() => void handleDelete()}
        >
          会一并删除该商品的全部周期状态与记录流水，且不可恢复。
          {deleteError && (
            <span className="mt-2 block text-rose-600">{deleteError}</span>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
