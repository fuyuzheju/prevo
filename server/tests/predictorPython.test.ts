import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../src/errors.js";
import { forecastNext14Days, type ForecastRequest } from "../src/modules/predictor.js";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(TESTS_DIR, "fixtures");
const MAIN_PY = path.resolve(TESTS_DIR, "../python/main.py");

const REQUEST: ForecastRequest = {
  skuId: "SKU-1",
  skuName: "SKU-1",
  asOfDate: "2026-01-10",
  dailyTotals: [
    { date: "2026-01-08", total: 4 },
    { date: "2026-01-09", total: 0 },
    { date: "2026-01-10", total: 6 },
  ],
};

// Env overrides are process-wide, so every case restores what it touched.
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env.PREDICTOR_PYTHON = ORIGINAL_ENV.PREDICTOR_PYTHON;
  process.env.PREDICTOR_SCRIPT = ORIGINAL_ENV.PREDICTOR_SCRIPT;
  process.env.PREDICTOR_TIMEOUT_MS = ORIGINAL_ENV.PREDICTOR_TIMEOUT_MS;
  if (ORIGINAL_ENV.PREDICTOR_PYTHON === undefined) delete process.env.PREDICTOR_PYTHON;
  if (ORIGINAL_ENV.PREDICTOR_SCRIPT === undefined) delete process.env.PREDICTOR_SCRIPT;
  if (ORIGINAL_ENV.PREDICTOR_TIMEOUT_MS === undefined) delete process.env.PREDICTOR_TIMEOUT_MS;
});

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

async function expectPredictorFailure(): Promise<ApiError> {
  try {
    await forecastNext14Days(REQUEST);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(500);
    expect(error.code).toBe("PREDICTOR_FAILED");
    return error;
  }
  throw new Error("expected the forecast to reject");
}

describe("the predictor process boundary", () => {
  it("runs the real model against a hand-checkable series", async () => {
    const forecast = await forecastNext14Days(REQUEST);
    // 3 days of history: 4 + 0 + 6 = 10 → mean 10/3, both weeks equal
    expect(forecast.method).toBe("FULL_MEAN_FALLBACK");
    expect(forecast.windowDays).toBe(3);
    expect(forecast.dailyRate).toBeCloseTo(10 / 3, 9);
    expect(forecast.predictedTotal).toBeCloseTo((10 / 3) * 14, 9);
  });

  it("fails when the interpreter cannot be started", async () => {
    process.env.PREDICTOR_PYTHON = "definitely-not-a-real-interpreter-xyz";
    const error = await expectPredictorFailure();
    expect(error.message).toContain("could not start predictor");
  });

  it("fails when the process exits non-zero with no output", async () => {
    // node cannot parse a .py file, so it exits non-zero and prints to stderr.
    process.env.PREDICTOR_PYTHON = process.execPath;
    const error = await expectPredictorFailure();
    expect(error.message).toContain("exited with code");
  });

  it("fails when stdout is not JSON", async () => {
    process.env.PREDICTOR_SCRIPT = fixture("bad_output.py");
    const error = await expectPredictorFailure();
    expect(error.message).toContain("unparseable output");
  });

  it("surfaces a structured error reported by the predictor", async () => {
    process.env.PREDICTOR_SCRIPT = fixture("reports_error.py");
    const error = await expectPredictorFailure();
    expect(error.message).toBe("boom");
  });

  it("fails when the predictor does not finish in time", async () => {
    process.env.PREDICTOR_SCRIPT = fixture("hangs.py");
    process.env.PREDICTOR_TIMEOUT_MS = "1500";
    const error = await expectPredictorFailure();
    expect(error.message).toContain("timed out");
  }, 20_000);
});

// `main.py`'s request contract, driven directly: `forecastNext14Days` always
// builds well-formed rows, so the rejections the adapter owes its callers are
// only reachable over the raw stdin boundary. See `python/main.py`'s docstring.
interface AdapterResponse {
  ok: boolean;
  predictions?: Record<string, unknown>[];
  error?: { code: string; message: string };
}

const ADAPTER_ROW = {
  sku_id: "SKU-1",
  sku_name: "SKU-1",
  date: "2026-01-08",
  sales_qty: 4,
  return_qty: 0,
  is_positive_demand: true,
  is_imputed_zero: false,
  source_day_status: "OK",
  data_quality_status: "OK",
};

const ADAPTER_PAYLOAD = {
  sku_id: "SKU-1",
  sku_name: "SKU-1",
  as_of_date: "2026-01-10",
  run_time: "2026-01-10T00:05:00",
  sku_daily: [ADAPTER_ROW],
};

function runAdapter(row: Record<string, unknown> = {}): AdapterResponse {
  const result = spawnSync(process.env.PREDICTOR_PYTHON ?? "python", [MAIN_PY], {
    input: JSON.stringify({ ...ADAPTER_PAYLOAD, sku_daily: [{ ...ADAPTER_ROW, ...row }] }),
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  return JSON.parse(result.stdout) as AdapterResponse;
}

function expectRejection(response: AdapterResponse, expected: RegExp): void {
  expect(response.ok).toBe(false);
  expect(response.error?.code).toBe("INVALID_REQUEST");
  expect(response.error?.message).toMatch(expected);
}

describe("the adapter's request validation", () => {
  it("returns effective_n and level alongside the 13 output columns", () => {
    const response = runAdapter();
    expect(response.ok).toBe(true);
    const record = response.predictions?.[0];
    // The series is padded to as_of_date, so one row dated 01-08 against a
    // 01-10 cutoff is 3 contiguous days: level 4/3 per day → 7 × 4/3 per week.
    expect(record?.["history_days"]).toBe(3);
    expect(record?.["effective_n"]).toBe(3);
    expect(record?.["level"]).toBeCloseTo(4 / 3, 12);
    expect(record?.["forecast_14d"]).toBeCloseTo((4 / 3) * 14, 12);
  });

  it("refuses a negative daily total instead of letting it lower the level", () => {
    expectRejection(runAdapter({ sales_qty: -4 }), /sales_qty must not be negative/);
  });

  it("refuses a return quantity that is not a number", () => {
    expectRejection(runAdapter({ return_qty: "abc" }), /return_qty must be a number/);
  });

  it("refuses an is_imputed_zero that is not a real boolean", () => {
    // The string "false" is truthy; coercing it would hide a real trading day.
    expectRejection(runAdapter({ is_imputed_zero: "false" }), /is_imputed_zero must be a boolean/);
  });
});
