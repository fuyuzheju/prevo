// Client-side parser for the "import historical sales from Excel" flow.
// Long table layout: one row per product - product | date | quantity.
// xlsx is loaded lazily (dynamic import) so the heavy library only loads
// when the user actually picks a file.

export interface ImportSalesRow {
  productType: string;
  date: string;
  amount: number;
}

export interface ParsedSalesSheet {
  entries: ImportSalesRow[];
  errors: string[];
}

// minimal structural view of xlsx (CJS interop differs between bundlers and
// plain node: the module may arrive as the default export or as the module)
interface SheetLib {
  read: (data: unknown, options?: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (sheet: unknown, options: Record<string, unknown>) => unknown[][];
  };
}

const PRODUCT_HEADERS = ["商品", "产品", "品名", "名称", "品类", "product", "item", "name"];
const DATE_HEADERS = ["日期", "时间", "date"];
const AMOUNT_HEADERS = ["数量", "销量", "销售", "amount", "sale", "sales"];

function isBlankCell(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

function cellText(value: unknown): string {
  if (value instanceof Date) return "";
  if (typeof value === "number") return "";
  return String(value ?? "").trim();
}

function normalizeDateKey(value: unknown): string | null {
  // Excel date-formatted cells come back as Date (UTC keeps the displayed day)
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const text = typeof value === "number" ? "" : String(value ?? "").trim();
  // support YYYY-MM-DD, YYYY/MM/DD, YYYY.M.D and full datetime prefixes
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(text);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (year === undefined || month === undefined || day === undefined) return null;
  const pad = (n: string) => n.padStart(2, "0");
  const key = `${year}-${pad(month)}-${pad(day)}`;
  // round-trip guards against rolled-over dates like 2026-02-30
  const parts = key.split("-").map(Number);
  const parsedYear = parts[0];
  const parsedMonth = parts[1];
  const parsedDay = parts[2];
  if (parsedYear === undefined || parsedMonth === undefined || parsedDay === undefined) return null;
  const parsed = new Date(parsedYear, parsedMonth - 1, parsedDay);
  const valid =
    parsed.getFullYear() === parsedYear &&
    parsed.getMonth() + 1 === parsedMonth &&
    parsed.getDate() === parsedDay;
  return valid ? key : null;
}

function normalizeAmount(value: unknown): number | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/,/g, "").trim();
    if (cleaned === "") return null;
    raw = Number(cleaned);
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (!Number.isSafeInteger(raw) || raw <= 0) return null;
  return raw;
}

function isBlank(row: unknown[]): boolean {
  return row.every(isBlankCell);
}

interface HeaderLayout {
  productCol: number;
  dateCol: number;
  amountCol: number;
  headerRows: number; // number of leading rows to skip
}

// Scan leading non-empty rows for a header row containing product / date /
// amount columns. Without one, assume the columns are A/B/C.
function detectLayout(rows: unknown[][]): HeaderLayout {
  const scanned = rows.slice(0, 10);
  for (let i = 0; i < scanned.length; i++) {
    const row = scanned[i];
    if (row === undefined || isBlank(row)) continue;
    const textOf = (index: number) => cellText(row[index]).toLowerCase();
    const findCol = (headers: string[]) =>
      row.findIndex((_, index) => headers.some((h) => textOf(index).includes(h)));
    const productCol = findCol(PRODUCT_HEADERS);
    const dateCol = findCol(DATE_HEADERS);
    const amountCol = findCol(AMOUNT_HEADERS);
    if (productCol !== -1 && dateCol !== -1 && amountCol !== -1) {
      return { productCol, dateCol, amountCol, headerRows: i + 1 };
    }
  }
  return { productCol: 0, dateCol: 1, amountCol: 2, headerRows: 0 };
}

// Runtime guard for the shape of the xlsx module (its CJS interop differs
// between bundlers and plain node: the API may arrive as the default export
// or as the module itself).
function isSheetLib(value: unknown): value is SheetLib {
  if (typeof value !== "object" || value === null) return false;
  const read = "read" in value ? value.read : undefined;
  const utils = "utils" in value ? value.utils : undefined;
  if (typeof read !== "function") return false;
  if (typeof utils !== "object" || utils === null) return false;
  const sheetToJson = "sheet_to_json" in utils ? utils.sheet_to_json : undefined;
  return typeof sheetToJson === "function";
}

// Shared by the browser File flow and the node smoke test (a Buffer is a
// Uint8Array, so both work here).
export async function parseSalesSheetBytes(bytes: ArrayBuffer | Uint8Array): Promise<ParsedSalesSheet> {
  const mod: unknown = await import("xlsx");
  const candidate =
    typeof mod === "object" && mod !== null && "default" in mod ? mod.default : mod;
  if (!isSheetLib(candidate)) {
    return { entries: [], errors: ["无法读取该文件，请确认为 .xlsx / .xls / .csv 格式"] };
  }
  const lib: SheetLib = candidate;
  let rows: unknown[][];
  try {
    const workbook = lib.read(bytes, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { entries: [], errors: ["文件里没有工作表"] };
    const sheet = workbook.Sheets[sheetName];
    if (sheet === undefined) return { entries: [], errors: ["文件里没有工作表"] };
    // raw:false reads the *formatted* cell text — dates come back exactly as
    // they are displayed in the spreadsheet, so no timezone shifting applies.
    rows = lib.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });
  } catch {
    return { entries: [], errors: ["无法读取该文件，请确认为 .xlsx / .xls / .csv 格式"] };
  }
  if (rows.length === 0) {
    return { entries: [], errors: ["文件中没有可读取的行"] };
  }

  const { productCol, dateCol, amountCol, headerRows } = detectLayout(rows);
  const dataRows = rows.slice(headerRows);
  if (dataRows.length === 0 || dataRows.every(isBlank)) {
    return { entries: [], errors: ["文件中没有可读取的数据行"] };
  }
  const entries: ImportSalesRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((row, offset) => {
    const rowIndex = headerRows + offset + 1; // 1-based, as displayed
    if (isBlank(row)) return;
    const product = normalizeProduct(row[productCol]);
    const dateKey = normalizeDateKey(row[dateCol]);
    const amount = normalizeAmount(row[amountCol]);
    if (!product) {
      errors.push(`第 ${rowIndex} 行:商品名缺失`);
      return;
    }
    if (!dateKey) {
      errors.push(`第 ${rowIndex} 行:日期无效（应为 YYYY-MM-DD 或 Excel 日期）`);
      return;
    }
    if (amount === null) {
      errors.push(`第 ${rowIndex} 行:数量无效（应为正整数）`);
      return;
    }
    entries.push({ productType: product, date: dateKey, amount });
  });

  return { entries, errors };
}

function normalizeProduct(value: unknown): string | null {
  if (typeof value === "number") {
    // product names can be numeric strings like "1234"
    return Number.isInteger(value) ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function parseSalesSheetFile(file: File): Promise<ParsedSalesSheet> {
  return parseSalesSheetBytes(await file.arrayBuffer());
}
