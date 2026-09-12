import { useMemo, useRef, useState } from "react";
import { DatabaseBackup, FileSpreadsheet, Upload } from "lucide-react";
import { isValidProductName } from "../../../shared/model.ts";
import * as api from "../lib/api.ts";
import type { ProductItem } from "../lib/types.ts";
import { parseSalesSheetFile, type ParsedSalesSheet } from "../lib/excelImport.ts";
import { Button, CenteredSpinner, ConfirmDialog, InlineMessage, Modal, cn } from "./ui.tsx";

export function ImportSalesDialog({
  products,
  reload,
  onClose,
  onImported,
}: {
  products: readonly ProductItem[];
  reload: () => Promise<ProductItem[]>;
  onClose: () => void;
  // Called with every product id whose imported data may have changed, plus
  // the ids of products this import created.
  onImported: (productIds: number[], createdIds: number[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSalesSheet | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);

  const knownSet = useMemo(() => new Set(products.map((p) => p.productType)), [products]);

  const unknownNames = useMemo(() => {
    if (!parsed) return new Set<string>();
    return new Set(
      parsed.entries
        .map((entry) => entry.productType)
        .filter((productName) => !knownSet.has(productName)),
    );
  }, [parsed, knownSet]);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of parsed?.entries ?? []) {
      counts.set(entry.productType, (counts.get(entry.productType) ?? 0) + 1);
    }
    return counts;
  }, [parsed]);

  const importableCount = parsed?.entries.length ?? 0;
  // Row errors block the whole import (the file must be fixed); unknown
  // products do not — they are created after the user confirms.
  const hasRowErrors = parsed !== null && parsed.errors.length > 0;

  async function handleFile(file: File) {
    setPickedName(file.name);
    setParsed(null);
    setError(null);
    setOk(null);
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
    setError(null);
    setOk(null);
    try {
      const missing = [...unknownNames];
      const invalid = missing.filter((productName) => !isValidProductName(productName));
      if (invalid.length > 0) {
        setError(`商品名无效（应为 1-40 个字符，不含空白）：${invalid.join("、")}`);
        return;
      }
      await Promise.all(missing.map((productName) => createProductIfMissing(productName)));
      const known = new Set(products.map((product) => product.id));
      const list = missing.length > 0 ? await reload() : products;
      const created = list.filter((product) => !known.has(product.id)).map((product) => product.id);
      const count = await api.importSalesMany(parsed.entries);
      setOk(
        missing.length > 0
          ? `已导入 ${count} 条销量记录，并新建了 ${missing.length} 个商品`
          : `已导入 ${count} 条销量记录`,
      );
      setConfirmCreate(false);
      resetPicked();
      onImported(list.map((product) => product.id), created);
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  const resetPicked = () => {
    setPickedName(null);
    setParsed(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <DatabaseBackup className="size-4 text-blue-600" />
          导入历史销量
        </span>
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-slate-400">
          一张表可包含多种商品：每行 = 商品 | 日期 | 数量（表头名可不同，其余列忽略）。
          仅用于预测，不影响库存与状态机；真实出售记录会自动计入。表里出现不存在的商品时会先提示，
          确认导入后按默认起订点自动创建；有任何一行数据错误时整批都不会导入。
        </p>

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

        {/* outside the parsed block: a successful import resets the file picker */}
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {ok && <InlineMessage tone="success">{ok}</InlineMessage>}

        {!parsing && parsed && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              {pickedName}：{parsed.entries.length === 0 ? "没有可导入的行" : `可导入 ${importableCount} 条`}
              {unknownNames.size > 0 && (
                <span className="text-amber-600">（{unknownNames.size} 个商品待创建）</span>
              )}
              {parsed.errors.length > 0 && (
                <span className="text-amber-600">（{parsed.errors.length} 行错误）</span>
              )}
            </p>

            {hasRowErrors && (
              <InlineMessage tone="error">文件存在下列问题，修正后重新选择文件再导入。</InlineMessage>
            )}
            {unknownNames.size > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                以下商品还没有创建：{[...unknownNames].join("、")}。
                确认导入时会自动创建这些商品（起订点默认不限），再导入它们的记录。
              </div>
            )}
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

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                关闭
              </Button>
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
          </div>
        )}

        {!parsing && !parsed && (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          </div>
        )}
      </div>

      {confirmCreate && parsed && (
        <ConfirmDialog
          title={`创建 ${unknownNames.size} 个新商品并导入？`}
          confirmLabel="创建并导入"
          busy={importing}
          onCancel={() => {
            setConfirmCreate(false);
            setError(null);
          }}
          onConfirm={() => void handleImport()}
        >
          商品 {[...unknownNames].join("、")} 还不存在，将按默认起订点
          （不限制）创建，然后导入全部 {importableCount} 条记录。
          {error && <span className="mt-2 block text-rose-600">{error}</span>}
        </ConfirmDialog>
      )}
    </Modal>
  );
}
