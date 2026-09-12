import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DatabaseBackup,
  FileSpreadsheet,
  PackagePlus,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { isValidProductName } from "../../../shared/model.ts";
import { formatQuantity, parseQuantity } from "../../../shared/quantity.ts";
import * as api from "../lib/api.ts";
import type { ImportedSaleItem } from "../lib/types.ts";
import { formatDate } from "../lib/format.ts";
import { parseSalesSheetFile, type ParsedSalesSheet } from "../lib/excelImport.ts";
import { useProducts } from "../hooks/useProducts.ts";
import { ProductSidebar } from "../components/ProductSidebar.tsx";
import {
  Button,
  Card,
  CenteredSpinner,
  ConfirmDialog,
  Field,
  InlineMessage,
  Input,
  cn,
} from "../components/ui.tsx";

export function ProductsPage() {
  const { products, loading, error, reload } = useProducts();
  const productNames = useMemo(() => products.map((p) => p.productType), [products]);
  const nameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.productType])),
    [products],
  );

  // ---- excel import ----
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSalesSheet | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importOk, setImportOk] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);

  // ---- imported entries management (keyed by product id) ----
  const [importedByProduct, setImportedByProduct] = useState<Record<number, ImportedSaleItem[]>>({});
  const [importedLoading, setImportedLoading] = useState(false);
  const [importedFilter, setImportedFilter] = useState<number | null>(null);

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

  // ---- add product ----
  const [name, setName] = useState("");
  const [orderMultipleInput, setOrderMultipleInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOk, setAddOk] = useState<string | null>(null);

  // ---- edit product attributes (dialog) ----
  const [editing, setEditing] = useState<{ id: number; name: string; multiple: string } | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);

  // ---- delete product ----
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const knownSet = useMemo(() => new Set(productNames), [productNames]);

  const unknownNames = useMemo(() => {
    if (!parsed) return new Set<string>();
    return new Set(
      parsed.entries
        .map((entry) => entry.productType)
        .filter((productName) => !knownSet.has(productName)),
    );
  }, [parsed, knownSet]);

  const importableCount = parsed?.entries.length ?? 0;
  // Row errors block the whole import (the file must be fixed); unknown
  // products do not — they are created after the user confirms.
  const hasRowErrors = parsed !== null && parsed.errors.length > 0;

  async function handleFile(file: File) {
    setPickedName(file.name);
    setParsed(null);
    setImportError(null);
    setImportOk(null);
    setConfirmCreate(false);
    setParsing(true);
    try {
      setParsed(await parseSalesSheetFile(file));
    } catch {
      setParsed({
        entries: [],
        errors: ["无法读取该文件，请确认为 .xlsx / .xls / .csv 格式"],
        warnings: [],
      });
    } finally {
      setParsing(false);
    }
  }

  // A stale product list (another tab created the product meanwhile) must not
  // fail the import: PRODUCT_EXISTS means the product is already there.
  async function createProductIfMissing(productType: string): Promise<void> {
    try {
      await api.createProduct(productType);
    } catch (error) {
      if (!(error instanceof api.ApiError) || error.code !== "PRODUCT_EXISTS") throw error;
    }
  }

  async function handleImport() {
    if (!parsed || importableCount === 0) return;
    setImporting(true);
    setImportError(null);
    setImportOk(null);
    try {
      const missing = [...unknownNames];
      const invalid = missing.filter((productName) => !isValidProductName(productName));
      if (invalid.length > 0) {
        setImportError(`商品名无效（应为 1-40 个字符，不含空白）：${invalid.join("、")}`);
        return;
      }
      await Promise.all(missing.map((productName) => createProductIfMissing(productName)));
      const created = missing.length > 0 ? await reload() : products;
      const count = await api.importSalesMany(parsed.entries);
      setImportOk(
        missing.length > 0
          ? `已导入 ${count} 条销量记录，并新建了 ${missing.length} 个商品`
          : `已导入 ${count} 条销量记录`,
      );
      setConfirmCreate(false);
      resetPicked();
      await loadImported(created.map((p) => p.id));
    } catch (err) {
      setImportError(api.errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  const resetPicked = () => {
    setPickedName(null);
    setParsed(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // The scaled multiple, undefined for "no constraint" (empty input), or NaN
  // when invalid. 0.001 (1 scaled) is the smallest allowed multiple.
  function parseOrderMultiple(raw: string): number | undefined {
    if (raw.trim() === "") return undefined;
    const value = parseQuantity(raw);
    if (value === null || value < 1) return Number.NaN;
    return value;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setAddError(null);
    setAddOk(null);
    const trimmed = name.trim();
    if (!isValidProductName(trimmed)) {
      setAddError("商品名称需为 1-40 个字符，且不能包含空白");
      return;
    }
    if (knownSet.has(trimmed)) {
      setAddError("已有同名商品");
      return;
    }
    const orderMultiple = parseOrderMultiple(orderMultipleInput);
    if (Number.isNaN(orderMultiple)) {
      setAddError("起订点需为大于 0 的数字（最多 3 位小数）");
      return;
    }
    setAdding(true);
    try {
      await api.createProduct(trimmed, orderMultiple);
      setName("");
      setOrderMultipleInput("");
      setAddOk(`已添加商品「${trimmed}」`);
      await reload();
    } catch (err) {
      setAddError(api.errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  function startEdit(productId: number) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setEditing({ id: product.id, name: product.productType, multiple: String(product.orderMultiple) });
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
    try {
      await api.deleteImportedSale(productId, id);
      await loadImported(productIds);
    } catch (err) {
      setImportError(api.errorMessage(err));
    }
  }

  async function clearImportedFilter() {
    if (importedFilter === null) return;
    try {
      await api.clearImportedSales(importedFilter);
      await loadImported(productIds);
    } catch (err) {
      setImportError(api.errorMessage(err));
    }
  }

  const filterIds =
    importedFilter !== null
      ? [importedFilter]
      : productIds.filter((id) => (importedByProduct[id] ?? []).length > 0);
  const importedRows = useMemo(() => {
    const rows: (ImportedSaleItem & { productId: number })[] = [];
    for (const id of filterIds) {
      for (const entry of importedByProduct[id] ?? []) {
        rows.push({ ...entry, productId: id });
      }
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  }, [filterIds, importedByProduct]);
  const importedTotal = Object.values(importedByProduct).reduce((sum, list) => sum + list.length, 0);

  const target = products.find((p) => p.id === pendingDelete) ?? null;
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of parsed?.entries ?? []) {
      counts.set(entry.productType, (counts.get(entry.productType) ?? 0) + 1);
    }
    return counts;
  }, [parsed]);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <ProductSidebar products={products} loading={loading} mode="none" />

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">商品管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            管理商品及其属性（名称、起订点）与历史销量导入，之后可继续补充详细信息。
          </p>
        </div>

        {error && <InlineMessage tone="error">{error}</InlineMessage>}

        {/* import historical sales (multi-product excel) */}

        {/* add product */}
        <Card className="p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900">
            <PackagePlus className="size-4 text-blue-600" />
            新增商品
          </h2>
          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
              <Field label="商品名称" hint="1-40 个字符，不含空白">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：夏季T恤"
                />
              </Field>
              <Field label="起订点" hint="数字，最多 3 位小数；留空 = 不限制">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={orderMultipleInput}
                  onChange={(e) => setOrderMultipleInput(e.target.value)}
                  placeholder="留空不限制"
                />
              </Field>
              <Button type="submit" loading={adding} className="shrink-0">
                <Plus className="size-4" />
                添加
              </Button>
            </div>
            {addError && <InlineMessage tone="error">{addError}</InlineMessage>}
            {addOk && <InlineMessage tone="success">{addOk}</InlineMessage>}
          </form>
        </Card>

        {/* product list */}
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
                <li key={product.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 font-semibold text-blue-600">
                    {(product.productType[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-800">{product.productType}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-slate-400">
                      ID #{product.id} · 创建于 {formatDate(product.createdAt)}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                        起订点{" "}
                        {product.orderMultiple === 1 ? "不限" : formatQuantity(product.orderMultiple)}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setImportedFilter(product.id);
                    }}
                    className="text-xs font-medium text-blue-600 hover:underline"
                  >
                    历史销量 {importedByProduct[product.id]?.length ?? 0} 条
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(product.id)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                  >
                    <Pencil className="size-3.5" />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(product.id)}
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

        <Card>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="flex items-center gap-1.5 font-semibold text-slate-900">
              <DatabaseBackup className="size-4 text-blue-600" />
              导入历史销量
              {importedTotal > 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium tabular-nums text-blue-600">
                  已导入 {importedTotal} 条
                </span>
              )}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              一张表可包含多种商品：每行 = 商品 | 日期 | 数量（表头名可不同，其余列忽略）。
              仅用于预测，不影响库存与状态机；真实出售记录会自动计入。表里出现不存在的商品时会先提示，
              确认导入后按默认起订点自动创建；有任何一行数据错误时整批都不会导入。
            </p>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50">
                <FileSpreadsheet className="size-4" />
                {pickedName ? "重新选择文件" : "选择 Excel 文件"}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
              <span className="text-xs text-slate-400">支持 .xlsx / .xls / .csv，仅读取第一个工作表</span>
            </div>

            {parsing && <CenteredSpinner label="解析文件…" />}

            {!parsing && parsed && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-700">
                    {pickedName}：{parsed.entries.length === 0 ? "没有可导入的行" : `可导入 ${importableCount} 条`}
                    {unknownNames.size > 0 && (
                      <span className="text-amber-600">（{unknownNames.size} 个商品待创建）</span>
                    )}
                    {parsed.errors.length > 0 && <span className="text-amber-600">（{parsed.errors.length} 行错误）</span>}
                  </p>
                  <Button
                    disabled={importableCount === 0 || hasRowErrors}
                    loading={importing}
                    onClick={() => {
                      if (unknownNames.size > 0) setConfirmCreate(true);
                      else void handleImport();
                    }}
                  >
                    <Upload className="size-4" />
                    确认导入{importableCount > 0 ? ` ${importableCount} 条` : ""}
                  </Button>
                </div>

                {hasRowErrors && (
                  <InlineMessage tone="error">
                    文件存在下列问题，修正后重新选择文件再导入。
                  </InlineMessage>
                )}
                {unknownNames.size > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                    以下商品还没有创建：{[...unknownNames].join("、")}。
                    确认导入时会自动创建这些商品（起订点默认不限），再导入它们的记录。
                  </div>
                )}
                {importError && <InlineMessage tone="error">{importError}</InlineMessage>}
                {importOk && <InlineMessage tone="success">{importOk}</InlineMessage>}

                {parsed.entries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...groupCounts.entries()].map(([productName, count]) => (
                      <span
                        key={productName}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          knownSet.has(productName)
                            ? "bg-blue-50 text-blue-700"
                            : "bg-amber-50 text-amber-700",
                        )}
                      >
                        {productName} × {count}
                      </span>
                    ))}
                  </div>
                )}
                {parsed.errors.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                    {parsed.errors.map((err, index) => (
                      <p key={index}>{err}</p>
                    ))}
                  </div>
                )}
                {parsed.warnings.length > 0 && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                    {parsed.warnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* imported history management */}
        {importedTotal > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">已导入历史销量</h2>
              <div className="flex items-center gap-2">
                <select
                  value={importedFilter === null ? "" : String(importedFilter)}
                  onChange={(e) =>
                    setImportedFilter(e.target.value === "" ? null : Number(e.target.value))
                  }
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">全部商品</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.productType}
                    </option>
                  ))}
                </select>
                {importedFilter !== null && (
                  <button
                    type="button"
                    onClick={() => void clearImportedFilter()}
                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                  >
                    <Trash2 className="size-3" /> 清空该商品
                  </button>
                )}
              </div>
            </div>
            {importedLoading ? (
              <CenteredSpinner label="加载中…" />
            ) : importedRows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">该筛选下没有导入记录</p>
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

      {/* edit attributes dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <Card className="w-full max-w-sm p-5">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-semibold text-slate-900">编辑商品属性</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="关闭"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
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
          </Card>
        </div>
      )}

      {confirmCreate && parsed && (
        <ConfirmDialog
          title={`创建 ${unknownNames.size} 个新商品并导入？`}
          confirmLabel="创建并导入"
          busy={importing}
          onCancel={() => {
            setConfirmCreate(false);
            setImportError(null);
          }}
          onConfirm={() => void handleImport()}
        >
          商品 {[...unknownNames].join("、")} 还不存在，将按默认起订点
          （不限制）创建，然后导入全部 {importableCount} 条记录。
          {importError && <span className="mt-2 block text-rose-600">{importError}</span>}
        </ConfirmDialog>
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
