import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  DatabaseBackup,
  PackageCheck,
  PackagePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { isValidProductName } from "../../../shared/model.ts";
import { formatQuantity, parseQuantity } from "../../../shared/quantity.ts";
import * as api from "../lib/api.ts";
import type { ImportedSaleItem, ProductItem } from "../lib/types.ts";
import { formatDate } from "../lib/format.ts";
import { computeLiveStatus } from "../lib/status.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { useProductSelection } from "../hooks/useProductSelection.ts";
import { useProductStates, type ProductState } from "../hooks/useProductStates.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import { AddProductDialog } from "../components/AddProductDialog.tsx";
import { ImportSalesDialog } from "../components/ImportSalesDialog.tsx";
import {
  Button,
  Card,
  CenteredSpinner,
  ConfirmDialog,
  Field,
  InlineMessage,
  Input,
  Modal,
  cn,
} from "../components/ui.tsx";

export function ProductsPage() {
  const { products, loading, error, reload } = useProducts();
  const { checked, selectedIds, toggle, toggleAll } = useProductSelection(products, {
    defaultAll: true,
  });
  const { results, load } = useProductStates(products, selectedIds);

  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const knownSet = useMemo(() => new Set(products.map((p) => p.productType)), [products]);
  const nameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.productType])),
    [products],
  );

  // ---- imported entries management (keyed by product id) ----
  const [importedByProduct, setImportedByProduct] = useState<Record<number, ImportedSaleItem[]>>({});
  const [importedLoading, setImportedLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadImported = useCallback(async (ids: number[]) => {
    setImportedLoading(true);
    try {
      const entries = await Promise.all(ids.map((id) => api.listImportedSales(id)));
      const map: Record<number, ImportedSaleItem[]> = {};
      ids.forEach((id, index) => {
        map[id] = entries[index] ?? [];
      });
      setImportedByProduct(map);
    } catch {
      setImportedByProduct({});
    } finally {
      setImportedLoading(false);
    }
  }, []);

  const productIds = useMemo(() => products.map((p) => p.id), [products]);

  useEffect(() => {
    if (productIds.length > 0) void loadImported(productIds);
  }, [productIds, loadImported]);

  // ---- edit product attributes (dialog) ----
  const [editing, setEditing] = useState<{ id: number; name: string; multiple: string } | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);

  // ---- delete product ----
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The scaled multiple, undefined for "no constraint" (empty input), or NaN
  // when invalid. 0.001 (1 scaled) is the smallest allowed multiple.
  function parseOrderMultiple(raw: string): number | undefined {
    if (raw.trim() === "") return undefined;
    const value = parseQuantity(raw);
    if (value === null || value < 1) return Number.NaN;
    return value;
  }

  function startEdit(productId: number) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setEditing({
      id: product.id,
      name: product.productType,
      // the stored value is fixed-point; 1 means "no constraint" and shows as empty
      multiple: product.orderMultiple === 1 ? "" : formatQuantity(product.orderMultiple),
    });
    setEditingError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const trimmedName = editing.name.trim();
    if (!isValidProductName(trimmedName)) {
      setEditingError("商品名称需为 1-40 个字符，且不能包含空白");
      return;
    }
    const multiple = parseOrderMultiple(editing.multiple);
    if (Number.isNaN(multiple)) {
      setEditingError("起订点需为大于 0 的数字（最多 3 位小数）");
      return;
    }
    setEditingSaving(true);
    setEditingError(null);
    try {
      await api.updateProduct(editing.id, {
        productType: trimmedName,
        orderMultiple: multiple ?? 1,
      });
      setEditing(null);
      await reload();
    } catch (err) {
      setEditingError(api.errorMessage(err));
    } finally {
      setEditingSaving(false);
    }
  }

  async function handleDelete() {
    if (pendingDelete === null) return;
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

  async function removeImportedRow(productId: number, id: number) {
    setHistoryError(null);
    try {
      await api.deleteImportedSale(productId, id);
      await loadImported(productIds);
    } catch (err) {
      setHistoryError(api.errorMessage(err));
    }
  }

  async function clearImported(productId: number) {
    setHistoryError(null);
    try {
      await api.clearImportedSales(productId);
      await loadImported(productIds);
    } catch (err) {
      setHistoryError(api.errorMessage(err));
    }
  }

  const selectedResults = selectedIds
    .map((id) => results[id])
    .filter((result): result is ProductState => Boolean(result));
  const anyLoading = selectedResults.some((result) => result.loading);

  const importedRows = useMemo(() => {
    const rows: (ImportedSaleItem & { productId: number })[] = [];
    for (const id of selectedIds) {
      for (const entry of importedByProduct[id] ?? []) {
        rows.push({ ...entry, productId: id });
      }
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  }, [selectedIds, importedByProduct]);

  const clearTarget = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const target = products.find((p) => p.id === pendingDelete) ?? null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar
        products={products}
        loading={loading}
        mode="check"
        checked={checked}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">商品管理</h1>
            <p className="mt-1 text-sm text-slate-500">
              管理商品及其属性（名称、起订点）与历史销量导入；勾选左侧商品可只看它们的详细信息。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setShowAdd(true)}>
              <PackagePlus className="size-4" />
              新增商品
            </Button>
            <Button onClick={() => setShowImport(true)}>
              <DatabaseBackup className="size-4" />
              导入历史销量
            </Button>
          </div>
        </div>

        {error && <InlineMessage tone="error">{error}</InlineMessage>}

        {!loading && products.length === 0 && !error && (
          <Card className="p-10 text-center">
            <Boxes className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">还没有商品</p>
            <p className="mt-1 text-sm text-slate-400">
              点右上角「新增商品」添加第一个，或在「导入历史销量」里按表批量创建。
            </p>
          </Card>
        )}

        {products.length > 0 && selectedIds.length === 0 && (
          <Card className="p-10 text-center">
            <CheckCircle2 className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">在左侧勾选商品查看详细信息</p>
            <p className="mt-1 text-sm text-slate-400">可多选；下方的历史销量也会随勾选过滤。</p>
          </Card>
        )}

        {selectedResults.length > 0 && (
          <>
            {anyLoading && <CenteredSpinner label="加载商品数据…" />}
            <Card>
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold text-slate-900">
                  商品详情
                  <span className="ml-2 text-sm font-normal tabular-nums text-slate-400">
                    {selectedResults.length} 种
                  </span>
                </h2>
              </div>
              <ul className="divide-y divide-slate-100">
                {selectedResults.map((result) => {
                  const product = products.find((p) => p.id === result.productId);
                  if (!product) return null;
                  return (
                    <ProductDetailRow
                      key={result.productId}
                      product={product}
                      result={result}
                      historyCount={importedByProduct[result.productId]?.length ?? 0}
                      onRetry={() => void load(result.productId)}
                      onEdit={() => startEdit(result.productId)}
                      onDelete={() => setPendingDelete(result.productId)}
                    />
                  );
                })}
              </ul>
              <div className="flex items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-5 py-2 text-xs text-slate-400">
                <PackageCheck className="size-3.5 shrink-0" />
                库存与可用量 = 已结算快照 + 本周期未结算流水推算的实时值
              </div>
            </Card>
          </>
        )}

        {importedRows.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">
                已导入历史销量
                <span className="ml-2 text-sm font-normal tabular-nums text-slate-400">
                  {importedRows.length} 条
                </span>
                <span className="ml-2 text-xs font-normal text-slate-400">
                  （随左侧勾选过滤）
                </span>
              </h2>
              {clearTarget !== undefined && (
                <button
                  type="button"
                  onClick={() => void clearImported(clearTarget)}
                  className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                >
                  <Trash2 className="size-3" /> 清空「{nameById.get(clearTarget) ?? ""}」的全部导入
                </button>
              )}
            </div>
            {historyError && (
              <div className="px-5 pt-3">
                <InlineMessage tone="error">{historyError}</InlineMessage>
              </div>
            )}
            {importedLoading ? (
              <CenteredSpinner label="加载中…" />
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-xs text-slate-400">
                      <th className="px-5 py-2.5 text-left font-medium">商品</th>
                      <th className="px-4 py-2.5 text-left font-medium">日期</th>
                      <th className="px-4 py-2.5 text-right font-medium">数量</th>
                      <th className="px-5 py-2.5 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {importedRows.map((entry) => (
                      <tr
                        key={`${entry.productId}-${entry.id}`}
                        className="border-t border-slate-100 text-slate-600 hover:bg-slate-50"
                      >
                        <td className="px-5 py-2.5 font-medium text-slate-800">
                          {nameById.get(entry.productId) ?? `#${entry.productId}`}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{formatDate(entry.date)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                          {formatQuantity(entry.amount)}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void removeImportedRow(entry.productId, entry.id)}
                            aria-label="删除该条导入"
                            className="rounded-lg p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {showAdd && (
        <AddProductDialog
          existingNames={knownSet}
          onClose={() => setShowAdd(false)}
          onCreated={(product) => {
            toggle(product.id, true);
            void reload();
          }}
        />
      )}

      {showImport && (
        <ImportSalesDialog
          products={products}
          reload={reload}
          onClose={() => setShowImport(false)}
          onImported={(ids, createdIds) => {
            for (const id of createdIds) toggle(id, true);
            void loadImported(ids);
          }}
        />
      )}

      {/* edit attributes dialog */}
      {editing && (
        <Modal title="编辑商品属性" onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <Field label="商品名称" hint="1-40 个字符，不含空白；修改后历史数据保持不变">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="起订点" hint="数字，最多 3 位小数；留空 = 不限制">
              <Input
                type="text"
                inputMode="decimal"
                value={editing.multiple}
                onChange={(e) => setEditing({ ...editing, multiple: e.target.value })}
              />
            </Field>
            {editingError && <InlineMessage tone="error">{editingError}</InlineMessage>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={editingSaving}>
                取消
              </Button>
              <Button onClick={() => void saveEdit()} loading={editingSaving}>
                保存
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {pendingDelete !== null && target && (
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
          会一并删除该商品的全部周期状态、记录流水与导入历史，且不可恢复。
          {deleteError && <span className="mt-2 block text-rose-600">{deleteError}</span>}
        </ConfirmDialog>
      )}
    </div>
  );
}

function ProductDetailRow({
  product,
  result,
  historyCount,
  onRetry,
  onEdit,
  onDelete,
}: {
  product: ProductItem;
  result: ProductState;
  historyCount: number;
  onRetry: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const live = computeLiveStatus(result.latest, result.records);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-semibold text-blue-600">
        {(product.productType[0] ?? "?").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 basis-52">
        <p className="truncate font-medium text-slate-800">{product.productType}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-slate-400">
          ID #{product.id} · 创建于 {formatDate(product.createdAt)}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            起订点 {product.orderMultiple === 1 ? "不限" : formatQuantity(product.orderMultiple)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            历史销量 {historyCount} 条
          </span>
        </p>
      </div>

      {result.error ? (
        <div className="min-w-0 flex-1">
          <InlineMessage tone="error">
            <span className="flex items-center justify-between gap-2">
              {result.error}
              <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
                重试
              </button>
            </span>
          </InlineMessage>
        </div>
      ) : (
        <div className="flex items-center gap-4 sm:gap-6">
          <RowStat label="当前库存" value={formatQuantity(live.inventory)} />
          <RowStat label="可用量" value={formatQuantity(live.available)} accent />
          <RowStat label="已售未发" value={formatQuantity(live.soldTransit)} />
          <RowStat label="采购在途" value={formatQuantity(live.boughtTransit)} />
        </div>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
        >
          <Pencil className="size-3.5" />
          编辑
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50"
        >
          <Trash2 className="size-3.5" />
          删除
        </button>
      </div>
    </li>
  );
}

function RowStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-14">
      <p className={cn("text-xs whitespace-nowrap", accent ? "text-blue-500" : "text-slate-400")}>
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-lg font-bold tabular-nums",
          accent ? "text-blue-600" : "text-slate-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}
