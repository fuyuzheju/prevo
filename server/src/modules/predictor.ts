import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ApiError } from "../errors.js";

// Sales predictor, implemented as a separate Python process.
//
// The model itself lives in `server/python/predict_core.py`; `server/python/main.py`
// owns the stdin/stdout contract. This module is only the transport: it hands the
// daily sales series over as JSON and reads the forecast back, so the model can be
// replaced wholesale without touching any TypeScript.
//
// See `server/python/main.py` for the exact request/response shape.

const DEFAULT_SCRIPT_PATH = fileURLToPath(new URL("../../python/main.py", import.meta.url));
const DEFAULT_TIMEOUT_MS = 30_000;

function scriptPath(): string {
  return process.env.PREDICTOR_SCRIPT ?? DEFAULT_SCRIPT_PATH;
}

function timeoutMs(): number {
  const configured = Number(process.env.PREDICTOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

export interface DailyTotal {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  total: number;
}

export interface ForecastRequest {
  skuId: string;
  skuName: string;
  /** Last known sales day, `YYYY-MM-DD` local. */
  asOfDate: string;
  /** Contiguous calendar days, oldest first; the caller zero-fills. */
  dailyTotals: readonly DailyTotal[];
}

export interface TwoWeekForecast {
  /** Days actually entering the average, for display. */
  windowDays: number;
  dailyRate: number;
  /** Predicted sales over the next 14 days — the safety stock. */
  predictedTotal: number;
  /** Model branch that produced this row, e.g. `WMA_84`. */
  method: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(500, "PREDICTOR_FAILED", `predictor did not return a valid "${key}"`);
  }
  return value;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value === "") {
    throw new ApiError(500, "PREDICTOR_FAILED", `predictor did not return a valid "${key}"`);
  }
  return value;
}

function failure(detail: string): ApiError {
  return new ApiError(500, "PREDICTOR_FAILED", detail);
}

/** Map one 13-column predictor record onto the shape the API exposes. */
function toForecast(record: unknown): TwoWeekForecast {
  if (!isObject(record)) {
    throw failure("predictor returned a malformed prediction");
  }
  const effectiveDays = requireNumber(record, "effective_n");
  return {
    // A zero-length history reports effective_n 0; fall back to history_days so
    // the reported window still describes the data that was considered.
    windowDays: effectiveDays > 0 ? effectiveDays : requireNumber(record, "history_days"),
    dailyRate: requireNumber(record, "level"),
    predictedTotal: requireNumber(record, "forecast_14d"),
    method: requireString(record, "model_id"),
  };
}

/** Run the Python predictor, resolving with its raw stdout. */
async function runPredictor(payload: unknown): Promise<string> {
  const interpreter = process.env.PREDICTOR_PYTHON ?? "./.venv/bin/python3";
  const timeout = timeoutMs();
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, [scriptPath()], {
      // Force UTF-8 both ways; the default Windows console code page would
      // mangle non-ASCII product names.
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(failure(`predictor timed out after ${timeout}ms`));
      });
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: Error) => {
      finish(() => reject(failure(`could not start predictor (${interpreter}): ${error.message}`)));
    });

    child.on("close", (code) => {
      finish(() => {
        if (code !== 0 && stdout.trim() === "") {
          reject(failure(`predictor exited with code ${String(code)}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      });
    });

    child.stdin.on("error", () => {
      // A closed stdin surfaces through the exit code instead; ignore the EPIPE.
    });
    child.stdin.end(JSON.stringify(payload), "utf8");
  });
}

/**
 * Forecast the next 14 days of sales for one SKU.
 *
 * Rejects with `ApiError(500, "PREDICTOR_FAILED")` when the predictor cannot be
 * started, exits abnormally, times out, or returns anything unparseable.
 */
export async function forecastNext14Days(request: ForecastRequest): Promise<TwoWeekForecast> {
  const payload = {
    sku_id: request.skuId,
    sku_name: request.skuName,
    as_of_date: request.asOfDate,
    run_time: new Date().toISOString(),
    // `sales_qty` carries the day's **signed net**, so a return day travels as
    // a negative number and drags the level down. `return_qty` stays 0: the
    // model never subtracts it from sales, and splitting a net return across
    // both fields would count the same day twice.
    sku_daily: request.dailyTotals.map((day) => ({
      sku_id: request.skuId,
      sku_name: request.skuName,
      date: day.date,
      sales_qty: day.total,
      return_qty: 0,
      is_positive_demand: day.total > 0,
      is_imputed_zero: day.total === 0,
      source_day_status: "OK",
      data_quality_status: "OK",
    })),
  };

  const stdout = await runPredictor(payload);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw failure(`predictor returned unparseable output: ${stdout.trim().slice(0, 200)}`);
  }
  if (!isObject(parsed) || parsed["ok"] !== true) {
    const error = isObject(parsed) && isObject(parsed["error"]) ? parsed["error"] : null;
    const message = error === null ? null : error["message"];
    throw failure(
      typeof message === "string" ? message : `predictor returned unparseable output: ${stdout.trim().slice(0, 200)}`,
    );
  }

  const predictions = parsed["predictions"];
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw failure("predictor returned no prediction");
  }
  return toForecast(predictions[0]);
}
