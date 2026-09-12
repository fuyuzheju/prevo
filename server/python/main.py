# -*- coding: utf-8 -*-
"""stdin/stdout adapter around `predict_core`.

This module owns the **process-boundary contract** between the Node server and
the forecasting model. It deliberately contains no algorithm: it parses a JSON
request from stdin, hands the data to `predict_core`, and prints the result as
JSON on stdout. Replacing the model means replacing `predict_core.py`; this
file should not need to change.

Request (stdin, UTF-8 JSON):

    {
      "sku_id":     "01011421",
      "sku_name":   "some product",
      "as_of_date": "2025-12-17",          # last known sales day
      "run_time":   "2025-12-17T00:05:00", # optional label
      "sku_daily": [                        # the 9-column SKU-Day contract
        {"sku_id": "...", "sku_name": "...", "date": "2025-12-01",
         "sales_qty": 12.0, "return_qty": 0.0, "is_positive_demand": true,
         "is_imputed_zero": false, "source_day_status": "OK",
         "data_quality_status": "OK"}
      ]
    }

`sales_qty` is the day's **signed net** sales: it must be a finite number and is
allowed to be negative (a return day, which has to pull the level down rather
than being dropped), and `is_imputed_zero` must be a real boolean; anything else
is refused as `INVALID_REQUEST` rather than coerced.

Response (stdout, UTF-8 JSON), success — `predictions` holds one record per the
deployment spec's 13 output columns, plus one adapter-added field:

    {"ok": true, "as_of_date": "2025-12-17", "predictions": [ {...} ]}

The 13 columns are exactly those of the spec's §4.1 contract. Two additional
fields come back alongside them — `effective_n` (days actually entering the
average; the spec exposes only `history_days`) and `level` (the daily level
before the ×7 horizon scaling) — because the model computes both anyway and the
UI reports them. Neither is a spec column, and neither is written to the
13-column table.

Response on failure, with a non-zero exit status:

    {"ok": false, "error": {"code": "...", "message": "..."}}

The series in `sku_daily` must be **contiguous calendar days**; the caller is
responsible for zero-filling. An empty `sku_daily` is not an error — it yields
the ALL_ZERO record for the requested SKU.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import traceback
from typing import Optional

import pandas as pd

import predict_core

# Output columns, in the order fixed by the deployment spec (§4.1).
_FLOAT_COLUMNS = ("forecast_week1", "forecast_week2", "forecast_14d", "level")
_INT_COLUMNS = ("history_days", "staleness_days", "effective_n")
_STR_COLUMNS = ("run_time", "cutoff_date", "sku_id", "sku_name", "model_id",
                "latest_data_date", "data_status", "forecast_status")


class RequestError(Exception):
    """Malformed request: the caller sent something this adapter cannot use."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RequestError(message)


def _parse_date(value: object, field: str) -> dt.date:
    _require(isinstance(value, str) and value != "",
             f"{field} must be a non-empty ISO date string")
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise RequestError(f"{field} is not a valid ISO date: {value!r}") from exc


def _number(row: dict, key: str, index: int, default: Optional[float] = None) -> float:
    """One finite number from `sku_daily[index]`; `default` covers absence.

    `bool` is rejected explicitly: it is an `int` subclass, so a stray `true`
    would otherwise read as the number 1.
    """
    value = row.get(key)
    if value is None and default is not None:
        return default
    _require(isinstance(value, (int, float)) and not isinstance(value, bool),
             f"sku_daily[{index}].{key} must be a number")
    number = float(value)
    _require(number == number and abs(number) != float("inf"),
             f"sku_daily[{index}].{key} must be finite")
    return number


def _build_sku_daily(rows: object) -> pd.DataFrame:
    """Turn the raw JSON rows into the 9-column SKU-Day table contract."""
    _require(isinstance(rows, list), "sku_daily must be an array")
    if not rows:
        return pd.DataFrame(columns=predict_core.DAILY_COLUMNS)

    records = []
    for index, row in enumerate(rows):
        _require(isinstance(row, dict), f"sku_daily[{index}] must be an object")
        sales_qty = _number(row, "sales_qty", index)
        # `sales_qty` is deliberately allowed to be negative: the caller sends
        # the day's signed net, so a return day has to pull the level down
        # instead of being dropped or parked in `return_qty` — the model never
        # subtracts `return_qty` from sales.
        imputed = row.get("is_imputed_zero")
        # Truthiness is not enough here: the string "false" is truthy, and this
        # flag decides whether the day counts as a real trading day.
        _require(imputed is None or isinstance(imputed, bool),
                 f"sku_daily[{index}].is_imputed_zero must be a boolean")
        records.append({
            "sku_id": str(row.get("sku_id", "")),
            "sku_name": str(row.get("sku_name", "")),
            "date": _parse_date(row.get("date"), f"sku_daily[{index}].date"),
            "sales_qty": sales_qty,
            "return_qty": _number(row, "return_qty", index, default=0.0),
            # Derived, never trusted from the wire.
            "is_positive_demand": sales_qty > 0,
            "is_imputed_zero": bool(imputed),
            "source_day_status": "OK",
            "data_quality_status": "OK",
        })
    frame = pd.DataFrame(records, columns=predict_core.DAILY_COLUMNS)
    return frame.sort_values(["sku_id", "date"]).reset_index(drop=True)


def _serialize(record: dict) -> dict:
    """Convert one forecast record to plain JSON-safe Python scalars.

    pandas/numpy scalars are not JSON-serializable, so every field is cast
    explicitly rather than relying on a generic encoder.
    """
    out = {}
    for key in (*predict_core.OUTPUT_COLUMNS, "effective_n", "level"):
        value = record.get(key)
        if key in _FLOAT_COLUMNS:
            number = float(value)
            if number != number or number in (float("inf"), float("-inf")):
                raise RequestError(f"model produced a non-finite {key}")
            out[key] = number
        elif key in _INT_COLUMNS:
            out[key] = int(value)
        elif key in _STR_COLUMNS:
            # latest_data_date is legitimately empty when the SKU has no data.
            out[key] = "" if value is None or value != value else str(value)
        else:
            raise RequestError(f"unexpected output column {key!r}")
    return out


def run(request: dict) -> dict:
    """Execute one forecast request and return the response payload."""
    _require(isinstance(request, dict), "request body must be a JSON object")

    sku_id = request.get("sku_id")
    _require(isinstance(sku_id, str) and sku_id != "",
             "sku_id must be a non-empty string")
    sku_id = str(sku_id)
    sku_name = request.get("sku_name")
    sku_name = str(sku_name) if isinstance(sku_name, str) else sku_id

    as_of_date = _parse_date(request.get("as_of_date"), "as_of_date")
    run_time = request.get("run_time")
    run_time = str(run_time) if isinstance(run_time, str) and run_time else None

    daily = _build_sku_daily(request.get("sku_daily"))

    # `forecast_sku` is total: on an empty table it yields the ALL_ZERO record
    # with latest_data_date "" and staleness -1, which is exactly the contract
    # for a SKU with no data. Only the display name needs restoring, since an
    # empty table carries none.
    #
    # The record also carries `effective_n` (days actually entering the average)
    # and `level` (the daily level before the ×7 horizon scaling) for the UI.
    # Neither is one of the spec's 13 output columns — the spec exposes only
    # `history_days`, and `level` only indirectly via `forecast_week1` — but
    # `predict` derives both on the way through, so they ride along rather than
    # being recomputed here from a second pass over the same series.
    record = predict_core.forecast_sku(daily, sku_id, as_of_date,
                                       run_time=run_time)
    if not record["sku_name"]:
        record["sku_name"] = sku_name

    return {
        "ok": True,
        "as_of_date": as_of_date.isoformat(),
        "predictions": [_serialize(record)],
    }


def main() -> int:
    # The wire format is UTF-8 in both directions; Windows would otherwise
    # fall back to the console code page and mangle non-ASCII SKU names.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")

    try:
        request = json.loads(sys.stdin.read())
        payload = run(request)
    except Exception as exc:  # noqa: BLE001 - the boundary reports everything
        traceback.print_exc(file=sys.stderr)
        code = "INVALID_REQUEST" if isinstance(exc, RequestError) else "PREDICT_FAILED"
        json.dump({"ok": False, "error": {"code": code, "message": str(exc)}},
                  sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1

    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
