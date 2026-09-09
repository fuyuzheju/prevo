// one-off: generate multi-product excel samples under ../samples and verify
// the parser on them
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseSalesSheetBytes } from "./src/lib/excelImport.ts";

const serialOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86400000) + 25569;
};
const dateCell = (key: string) => ({ t: "n", v: serialOf(key), z: "yyyy-mm-dd" });

function writeSample(file: string, rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "历史销量");
  XLSX.writeFile(wb, file);
}

// ---- clean sample: 4 products over ~17 days (early Aug..early Sep 2026) ----
interface Row {
  p: string;
  d: string;
  a: number | string; // string like "1,200" exercises thousands parsing
}
const plan: Row[] = [
  // 夏季T恤: near-daily, larger numbers
  ["夏季T恤", "2026-08-20", 120], ["夏季T恤", "2026-08-21", 95], ["夏季T恤", "2026-08-22", 140],
  ["夏季T恤", "2026-08-24", 88], ["夏季T恤", "2026-08-25", 110], ["夏季T恤", "2026-08-26", "160"],
  ["夏季T恤", "2026-08-28", 132], ["夏季T恤", "2026-08-30", 76], ["夏季T恤", "2026/9/1", 150],
  ["夏季T恤", "2026-09-03", 98], ["夏季T恤", "2026-09-05", 105],
  // 帆布鞋: occasional
  ["帆布鞋", "2026-08-21", 12], ["帆布鞋", "2026-08-25", 20], ["帆布鞋", "2026-08-28", 8],
  ["帆布鞋", "2026-09-02", 15], ["帆布鞋", "2026-09-05", 22],
  // 保温杯: sparse
  ["保温杯", "2026-08-23", 9], ["保温杯", "2026-08-27", 14], ["保温杯", "2026-08-31", 11],
  ["保温杯", "2026-09-04", 16],
  // 运动袜: with a thousands-formatted amount
  ["运动袜", "2026-08-22", 60], ["运动袜", "2026-08-26", 45], ["运动袜", "2026-08-29", "1,200"],
  ["运动袜", "2026-09-01", 70], ["运动袜", "2026-09-05", 55],
];
const clean: unknown[][] = [["商品", "日期", "数量"]];
for (const { p, d, a } of plan) {
  clean.push(/^\d{4}-\d{2}-\d{2}$/.test(d) ? [p, dateCell(d), a] : [p, d, a]);
}
writeSample("../samples/历史销量导入-示例.xlsx", clean);

// ---- sample with intentional errors (unknown product / bad date / decimal) ----
writeSample("../samples/历史销量导入-含错误.xlsx", [
  ["商品", "日期", "数量"],
  ["夏季T恤", dateCell("2026-09-01"), 100],
  ["渔夫帽", dateCell("2026-09-02"), 50], // not created yet
  ["夏季T恤", "2026-02-30", 40], // impossible date
  ["夏季T恤", dateCell("2026-09-04"), 12.5], // decimal amount
  ["", dateCell("2026-09-05"), 30], // missing product
]);

// ---- verify through the real parser ----
let failed = 0;
const check = (name: string, cond: boolean, extra = "") => {
  console.log(cond ? `PASS  ${name}` : `FAIL  ${name}  ${extra}`);
  if (!cond) failed++;
};

const a = await parseSalesSheetBytes(readFileSync("../samples/历史销量导入-示例.xlsx"));
check("clean: all rows parsed", a.entries.length === plan.length, `${a.entries.length} vs ${plan.length}`);
check("clean: no errors", a.errors.length === 0, JSON.stringify(a.errors));
check("clean: 4 products", new Set(a.entries.map((e) => e.productType)).size === 4);
check("clean: thousands parsed", a.entries.some((e) => e.productType === "运动袜" && e.amount === 1200));
check("clean: slash date normalized", a.entries.some((e) => e.productType === "夏季T恤" && e.date === "2026-09-01"));

const b = await parseSalesSheetBytes(readFileSync("../samples/历史销量导入-含错误.xlsx"));
check("errors sample: 2 valid rows", b.entries.length === 2, JSON.stringify(b.entries));
check("errors sample: rows flagged", b.errors.length === 3, JSON.stringify(b.errors));
check("errors sample: bad date row listed", b.errors.some((e) => e.includes("第 4 行")), JSON.stringify(b.errors));
check("errors sample: decimal amount listed", b.errors.some((e) => e.includes("第 5 行")), JSON.stringify(b.errors));

console.log(failed === 0 ? "\nALL SAMPLE CHECKS PASSED" : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
