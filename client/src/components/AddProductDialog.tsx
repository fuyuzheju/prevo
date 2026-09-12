import { useState, type FormEvent } from "react";
import { PackagePlus, Plus } from "lucide-react";
import { isValidProductName } from "../../../shared/model.ts";
import { parseQuantity } from "../../../shared/quantity.ts";
import * as api from "../lib/api.ts";
import type { ProductItem } from "../lib/types.ts";
import { Button, Field, InlineMessage, Input, Modal } from "./ui.tsx";

// The scaled multiple, undefined for "no constraint" (empty input), or NaN
// when invalid. 0.001 (1 scaled) is the smallest allowed multiple.
function parseOrderMultiple(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const value = parseQuantity(raw);
  if (value === null || value < 1) return Number.NaN;
  return value;
}

export function AddProductDialog({
  existingNames,
  onClose,
  onCreated,
}: {
  existingNames: ReadonlySet<string>;
  onClose: () => void;
  onCreated: (product: ProductItem) => void;
}) {
  const [name, setName] = useState("");
  const [orderMultipleInput, setOrderMultipleInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);
    const trimmed = name.trim();
    if (!isValidProductName(trimmed)) {
      setError("商品名称需为 1-40 个字符，且不能包含空白");
      return;
    }
    if (existingNames.has(trimmed)) {
      setError("已有同名商品");
      return;
    }
    const orderMultiple = parseOrderMultiple(orderMultipleInput);
    if (Number.isNaN(orderMultiple)) {
      setError("起订点需为大于 0 的数字（最多 3 位小数）");
      return;
    }
    setAdding(true);
    try {
      const created = await api.createProduct(trimmed, orderMultiple);
      setName("");
      setOrderMultipleInput("");
      setOk(`已添加商品「${trimmed}」，可继续添加下一个`);
      onCreated(created);
    } catch (err) {
      setError(api.errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <PackagePlus className="size-4 text-blue-600" />
          新增商品
        </span>
      }
      onClose={onClose}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleCreate} className="space-y-4">
        <Field label="商品名称" hint="1-40 个字符，不含空白">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：夏季T恤"
            autoFocus
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
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {ok && <InlineMessage tone="success">{ok}</InlineMessage>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            关闭
          </Button>
          <Button type="submit" loading={adding}>
            <Plus className="size-4" />
            添加
          </Button>
        </div>
      </form>
    </Modal>
  );
}
