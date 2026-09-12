# -*- coding: utf-8 -*-
"""WMA84: standalone, self-contained sales-forecast implementation.

This is the VENDORED copy of Prevo's current best model, deployed into this
repository. It started out equivalent to the reference implementation
(`wma84.py` shipped with `WMA84_Deployment_Spec.md`) with the comments and
docstrings translated to English to satisfy this repository's coding standards,
and has since taken four local correctness fixes that the reference still has:

- blank / `NaT` dates resolve to `None` (`BAD_DATE`) instead of reaching the
  callers as a `NaT` and crashing on the first date comparison;
- the raw table is read positionally, because `itertuples` renames columns that
  are not valid Python identifiers and a name lookup would silently miss;
- a caller's `colmap` merges over the defaults, so a partial map works and a
  missing column is reported instead of raising `KeyError`;
- `(sku_id, date)` stays unique when one SKU arrives under two display names.

The algorithm itself — constants, formulas, the fallback ladder and the 13-column
output contract — is unchanged.

**Replacing the model means replacing this file.** `main.py` owns the
stdin/stdout contract and must not need editing.

Design constraints
------------------
- **Zero internal dependencies**: imports only `numpy` / `pandas`; imports
  nothing from the originating project and depends on no named conda env.
  Copy the file and it works.
- **No file I/O**: pure functions over in-memory DataFrames. Persisting is
  the caller's business.
- **Deterministic**: no randomness, no global state. Same input, same output.

Model
-----
Take the 84 contiguous calendar days ending at `as_of_date` (the last known
sales day), x₁…x₈₄ ordered oldest → newest (missing days filled with 0.0;
**zero-sales days are kept and DO count toward the denominator**):

    level = Σ(i · xᵢ, i=1..84) / Σ(i, i=1..84) = Σ(i · xᵢ) / 3570
    week1 = week2 = max(0, 7 · level)

The most recent day carries weight 84, the oldest weight 1. Effective centroid
is ≈27.7 days (`84 − (2·84+1)/3`), almost exactly MA56's 28 days.

Cold-start fallback ladder (short history is **never** an error)
---------------------------------------------------------------
    positive days = 0     → ALL_ZERO            level = 0.0
    history < 28 days     → FULL_MEAN_FALLBACK  level = full-history mean
    28 ≤ history < 56     → MA_28_FALLBACK      level = last-28-day mean
    56 ≤ history < 84     → MA_56_FALLBACK      level = last-56-day mean
    history ≥ 84 days     → WMA_84              level = linear weighting above

Every branch divides by the **actually available day count**, never by the
nominal window length.

Platform note
-------------
This module avoids `np.dot` / `@` everywhere, using `(w * x).sum()` instead.
Under the originating project's half-activated conda environment a BLAS call
made the process vanish with `Windows fatal exception: code 0xc06d007f`.
Environments without that defect may switch back; keeping the current form is
harmless (and at k ≤ 84 it is not measurably slower).

Self-check
----------
    python predict_core.py
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

import numpy as np
import pandas as pd

__all__ = [
    "WMA_WINDOW",
    "SALE_TYPE", "RETURN_TYPE", "ALLOWED_TYPES",
    "OK", "ALL_ZERO", "INSUFFICIENT_HISTORY",
    "STALE_WARNING", "STALE_DATA",
    "WMA_84", "MA_56_FALLBACK", "MA_28_FALLBACK", "FULL_MEAN_FALLBACK",
    "NO_MODEL",
    "EMPTY_SKU", "BAD_DATE", "MISSING_QUANTITY", "UNKNOWN_TRANSACTION_TYPE",
    "AFTER_CUTOFF", "NEGATIVE_SALES_QTY",
    "DAILY_COLUMNS", "OUTPUT_COLUMNS", "DEFAULT_COLMAP",
    "clean_transactions", "build_sku_daily", "daily_series",
    "wma_level", "predict", "predict_all", "forecast",
]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
WMA_WINDOW = 84

# Transaction-type whitelist: only these two are recognized, everything else
# is discarded. These are business data values, not display strings.
SALE_TYPE = "销售单"
RETURN_TYPE = "销售退货单"
ALLOWED_TYPES = {SALE_TYPE, RETURN_TYPE}

# Model IDs
WMA_84 = "WMA_84"
MA_56_FALLBACK = "MA_56_FALLBACK"
MA_28_FALLBACK = "MA_28_FALLBACK"
FULL_MEAN_FALLBACK = "FULL_MEAN_FALLBACK"
NO_MODEL = "ALL_ZERO"

# Forecast status codes
OK = "OK"
ALL_ZERO = "ALL_ZERO"
INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"

# Data-freshness status codes
STALE_WARNING = "STALE_WARNING"
STALE_DATA = "STALE_DATA"

# Data-quality issue reason codes
EMPTY_SKU = "EMPTY_SKU"
BAD_DATE = "BAD_DATE"
MISSING_QUANTITY = "MISSING_QUANTITY"
UNKNOWN_TRANSACTION_TYPE = "UNKNOWN_TRANSACTION_TYPE"
AFTER_CUTOFF = "AFTER_CUTOFF"          # later than as_of_date, excluded (not an error)
NEGATIVE_SALES_QTY = "NEGATIVE_SALES_QTY"

# Standardized SKU-Day table columns (9-column contract)
DAILY_COLUMNS = [
    "sku_id", "sku_name", "date", "sales_qty", "return_qty",
    "is_positive_demand", "is_imputed_zero",
    "source_day_status", "data_quality_status",
]

# Output forecast table columns (13-column contract)
OUTPUT_COLUMNS = [
    "run_time", "cutoff_date", "sku_id", "sku_name", "model_id",
    "forecast_week1", "forecast_week2", "forecast_14d",
    "history_days", "latest_data_date", "staleness_days",
    "data_status", "forecast_status",
]

# Column mapping for the raw transaction table. Defaults to the originating
# project's Chinese column names; callers with other field names pass their own
# mapping, which is merged over these rather than replacing them.
DEFAULT_COLMAP = {
    "record_no": "行号",
    "date": "单据日期",
    "trade_type": "单据类型",
    "sku_id": "存货编号",
    "sku_name": "存货全名",
    "quantity": "数量",
}

_ISSUE_COLUMNS = ["record_no", "sku_id", "sku_name", "date", "trade_type",
                  "quantity", "reason", "detail"]


# ---------------------------------------------------------------------------
# Step 1: clean the raw transaction detail
# ---------------------------------------------------------------------------
def _to_date(v) -> Optional[dt.date]:
    """Any value → datetime.date; returns None when missing or unparseable."""
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        # pd.NaT is a datetime subclass whose .date() returns NaT instead of
        # raising, so a blank cell would otherwise reach the callers as a
        # non-None "date" and blow up on the first comparison against a date.
        return None if pd.isna(v) else v.date()
    if isinstance(v, dt.date):
        return v
    try:
        parsed = pd.to_datetime(v)
    except Exception:
        return None
    # pd.to_datetime answers NaT rather than raising for "", NaN and pd.NA.
    return None if pd.isna(parsed) else parsed.date()


def _is_blank(value) -> bool:
    """Missing, NaN or whitespace-only — all count as an empty field."""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _column_map(colmap: Optional[dict]) -> dict:
    """`DEFAULT_COLMAP` with the caller's entries merged over it.

    Merging rather than replacing is what lets a caller override a single field;
    checking the keys here is also the only thing that can catch a map that is
    merely incomplete, which would otherwise surface as a `KeyError` deep in the
    row loop. An unknown key is a typo and is rejected for the same reason.
    """
    cm = dict(DEFAULT_COLMAP)
    if colmap is not None:
        unknown = sorted(k for k in colmap if k not in cm)
        if unknown:
            raise ValueError("未知的 colmap 键: %s（可用键: %s）"
                             % (unknown, sorted(cm)))
        cm.update(colmap)
    return cm


def clean_transactions(raw: pd.DataFrame, as_of_date: dt.date,
                       colmap: Optional[dict] = None
                       ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Validate + normalize: raw transaction rows → valid transaction records.

    Checks run row by row, **in priority order, first match wins** (identical
    to `load.validate_and_normalize`):

        1. empty SKU                 → EMPTY_SKU
        2. empty / unparseable date  → BAD_DATE
        3. missing / non-numeric qty → MISSING_QUANTITY
        4. type outside the whitelist→ UNKNOWN_TRANSACTION_TYPE
        5. date > as_of_date         → AFTER_CUTOFF
        6. sales row with qty < 0    → NEGATIVE_SALES_QTY

    Returns `(valid, issues)`:
        valid  the records that passed; columns
               `record_no, sku_id, sku_name, date, sale, trade_type`
        issues the excluded records with a reason; columns as in
               `_ISSUE_COLUMNS`

    Conventions (get these wrong and every number shifts)
    -----------------------------------------------------
    - A **negative quantity on a sales row is discarded**, never reinterpreted
      as a return;
    - Sales-return rows **keep their original sign (usually negative) but are
      never subtracted from sales** — they only populate `return_qty`;
      `sales_qty` is unaffected. Returns are a separate metric, not negative
      sales.
    - **No deduplication of any kind.** Collapsing rows that share
      "SKU + quantity + time + type" is wrong: two same-day, same-quantity
      orders for one SKU are entirely normal business. The raw data has no
      unique key such as "document no. + line no.", so duplicates cannot be
      identified reliably.
    """
    cm = _column_map(colmap)
    missing = [c for c in cm.values() if c not in raw.columns]
    if missing:
        raise ValueError("原始交易表缺少列: %s（可用 colmap 指定映射）" % missing)

    # Read positionally: `itertuples` renames any column that is not a valid
    # Python identifier to `_0`, `_1`, … , so looking the column up by name
    # would either miss it or — worse — read a different column silently.
    fields = ("record_no", "date", "trade_type", "sku_id", "sku_name", "quantity")
    rows = raw[[cm[field] for field in fields]]

    valid, issues = [], []

    def _bad(rec_no, sku_id, sku_name, d, trade_type, qty, reason, detail=""):
        issues.append({"record_no": rec_no, "sku_id": sku_id,
                       "sku_name": sku_name, "date": d, "trade_type": trade_type,
                       "quantity": qty, "reason": reason, "detail": detail})

    for rec_no, raw_date, trade_type, sku_id, sku_name, qty in rows.itertuples(
            index=False, name=None):
        d = _to_date(raw_date)

        if _is_blank(sku_id) or _is_blank(sku_name):
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 EMPTY_SKU, "SKU 为空")
            continue
        if d is None:
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 BAD_DATE, "日期为空或无法解析")
            continue
        if pd.isna(qty):
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 MISSING_QUANTITY, "数量缺失")
            continue
        if isinstance(qty, bool):
            # bool is an int subclass, so float(True) would read as 1.0.
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 MISSING_QUANTITY, "数量非数值")
            continue
        try:
            q = float(qty)
        except (TypeError, ValueError):
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 MISSING_QUANTITY, "数量非数值")
            continue
        if trade_type not in ALLOWED_TYPES:
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 UNKNOWN_TRANSACTION_TYPE, "未识别交易类型: %s" % trade_type)
            continue
        if d > as_of_date:
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 AFTER_CUTOFF, "晚于 as_of_date，不参与本次计算")
            continue
        if trade_type == SALE_TYPE and q < 0:
            _bad(rec_no, sku_id, sku_name, d, trade_type, qty,
                 NEGATIVE_SALES_QTY, "销售单出现负数量，默认不进入预测")
            continue

        valid.append({"record_no": rec_no, "sku_id": str(sku_id),
                      "sku_name": str(sku_name), "date": d, "sale": q,
                      "trade_type": trade_type})

    valid_df = pd.DataFrame(
        valid, columns=["record_no", "sku_id", "sku_name", "date", "sale",
                        "trade_type"])
    issues_df = pd.DataFrame(issues, columns=_ISSUE_COLUMNS)
    return valid_df, issues_df


# ---------------------------------------------------------------------------
# Step 2: SKU-Day aggregation + zero-filling to contiguous calendar days
# ---------------------------------------------------------------------------
def build_sku_daily(valid: pd.DataFrame, as_of_date: dt.date) -> pd.DataFrame:
    """Valid transaction records → standardized SKU-Day table (9-column contract).

    - Aggregate by `(sku_id, date)`; sales and returns are summed **separately**;
    - Each SKU's series starts at its **first transaction day** and runs to
      `as_of_date`;
    - Missing calendar days in between get `sales_qty = 0.0` and
      `is_imputed_zero = True`.

    The result satisfies: `(sku_id, date)` unique, dates contiguous,
    `sales_qty >= 0`. **Zero-sales days must be kept** — they count toward the
    denominator.
    """
    if valid is None or len(valid) == 0:
        return pd.DataFrame(columns=DAILY_COLUMNS)

    v = valid.copy()
    v["date"] = pd.to_datetime(v["date"]).dt.date

    sales = (v[v["trade_type"] == SALE_TYPE]
             .groupby(["sku_id", "date"], as_index=False)["sale"]
             .sum().rename(columns={"sale": "sales_qty"}))
    returns = (v[v["trade_type"] == RETURN_TYPE]
               .groupby(["sku_id", "date"], as_index=False)["sale"]
               .sum().rename(columns={"sale": "return_qty"}))
    present = pd.merge(sales, returns, on=["sku_id", "date"], how="outer")
    present["sales_qty"] = present["sales_qty"].fillna(0.0)
    present["return_qty"] = present["return_qty"].fillna(0.0)

    # One display name per SKU. Grouping by name as well would emit duplicate
    # (sku_id, date) rows whenever one SKU arrives under two spellings — a
    # rename, a stray trailing space — breaking this table's uniqueness
    # invariant. The lexicographically first name keeps the pick deterministic.
    names = (v[["sku_id", "sku_name"]].drop_duplicates()
             .sort_values(["sku_id", "sku_name"]).drop_duplicates("sku_id"))
    name_of = dict(names.itertuples(index=False))

    records = []
    for sku_id, sub in present.groupby("sku_id"):
        sku_name = name_of.get(sku_id, "")
        start = sub["date"].min()
        days = pd.date_range(start, as_of_date, freq="D").date
        present_days = set(sub["date"])
        sales_map = dict(zip(sub["date"], sub["sales_qty"]))
        return_map = dict(zip(sub["date"], sub["return_qty"]))
        for d in days:
            sq = float(sales_map.get(d, 0.0))
            records.append({
                "sku_id": sku_id, "sku_name": sku_name, "date": d,
                "sales_qty": sq,
                "return_qty": float(return_map.get(d, 0.0)),
                "is_positive_demand": bool(sq > 0),
                "is_imputed_zero": d not in present_days,
                "source_day_status": OK,
                "data_quality_status": OK,
            })
    daily = pd.DataFrame(records, columns=DAILY_COLUMNS)
    return daily.sort_values(["sku_id", "date"]).reset_index(drop=True)


def daily_series(sku_daily: pd.DataFrame, sku_id: str,
                 as_of_date: Optional[dt.date] = None) -> pd.Series:
    """Pull one SKU's contiguous calendar-day sales series out of the SKU-Day
    table (keeping only `date <= as_of_date`).

    `as_of_date=None` means "use everything already in the table" (the caller
    is then responsible for having truncated it).
    """
    sub = sku_daily[sku_daily["sku_id"].astype(str) == str(sku_id)][
        ["date", "sales_qty"]].copy()
    if len(sub) == 0:
        return pd.Series(dtype=float)
    sub["date"] = pd.to_datetime(sub["date"]).dt.date
    if as_of_date is not None:
        sub = sub[sub["date"] <= as_of_date]
    if len(sub) == 0:
        return pd.Series(dtype=float)
    # The series must be padded up to as_of_date, not just to the last row in
    # the table: if this SKU had no transactions over the last few days, those
    # are zero-sales days too and must count toward the denominator.
    end = sub["date"].max() if as_of_date is None else as_of_date
    start = min(sub["date"].min(), end)
    idx = pd.date_range(start, end, freq="D").date
    by_day = sub.groupby("date")["sales_qty"].sum()
    return by_day.reindex(idx, fill_value=0.0).astype(float)


# ---------------------------------------------------------------------------
# Step 3: the core algorithm
# ---------------------------------------------------------------------------
def wma_level(day_vals: pd.Series, window: int = WMA_WINDOW
              ) -> tuple[float, int]:
    """Pure WMA84 core: returns `(daily level, days actually used)`, with **no
    fallback of any kind**.

    `k = min(window, available days)`; weights `1..k` ascending are applied to
    the time-ascending series (so the most recent day gets weight k), then
    divided by `k(k+1)/2` for self-normalization. At `k = 84` the denominator
    is exactly 3570.
    """
    k = int(min(window, len(day_vals)))
    if k <= 0:
        return 0.0, 0
    tail = day_vals.iloc[-k:]
    w = np.arange(1, k + 1, dtype=float)
    x = np.asarray(tail, dtype=float)
    return float((w * x).sum()) / float(w.sum()), k


def _last_n_mean(day_vals: pd.Series, n: int) -> float:
    """Mean over the last n calendar days, zero-sales days included (falls back
    to all available days when fewer than n exist)."""
    tail = day_vals.tail(n)
    if len(tail) == 0:
        return 0.0
    return float(tail.sum()) / len(tail)


def predict(day_vals: pd.Series) -> dict:
    """Forecast one SKU from its contiguous calendar-day series (fallback
    ladder + WMA84).

    Returns a dict:
        model_id          ∈ {WMA_84, MA_56_FALLBACK, MA_28_FALLBACK,
                             FULL_MEAN_FALLBACK, ALL_ZERO}
        forecast_week1/2  sum over 7 days (flat two weeks, week1 == week2),
                          `max(0, 7·level)`
        forecast_14d      week1 + week2
        level             daily level (not ×7, not truncated)
        history_days      contiguous calendar days (imputed and zero-sales
                          days included)
        effective_n       days actually entering the calculation
        forecast_status   ∈ {OK, INSUFFICIENT_HISTORY, ALL_ZERO}
    """
    history_days = int(len(day_vals))
    positive_days = int((day_vals > 0).sum()) if history_days else 0

    if positive_days == 0:
        # No positive sales at all (empty series included) → emit 0
        level, model_id, status, eff_n = 0.0, NO_MODEL, ALL_ZERO, 0
    elif history_days < 28:
        level = (float(day_vals.sum()) / history_days) if history_days else 0.0
        model_id, status, eff_n = (FULL_MEAN_FALLBACK, INSUFFICIENT_HISTORY,
                                   history_days)
    elif history_days < 56:
        level, model_id, status = _last_n_mean(day_vals, 28), MA_28_FALLBACK, OK
        eff_n = 28
    elif history_days < 84:
        level, model_id, status = _last_n_mean(day_vals, 56), MA_56_FALLBACK, OK
        eff_n = 56
    else:
        level, eff_n = wma_level(day_vals, WMA_WINDOW)
        model_id, status = WMA_84, OK

    w1 = max(0.0, 7.0 * level)
    return {
        "model_id": model_id,
        "forecast_week1": w1,
        "forecast_week2": w1,
        "forecast_14d": w1 + w1,
        "level": level,
        "history_days": history_days,
        "effective_n": int(eff_n),
        "forecast_status": status,
    }


# ---------------------------------------------------------------------------
# Step 4: the output table (13-column contract)
# ---------------------------------------------------------------------------
def _check_freshness(latest_data_date: Optional[dt.date],
                     run_date: dt.date) -> tuple[int, str]:
    """staleness_days = run_date − latest_data_date → data freshness status."""
    if latest_data_date is None:
        return -1, STALE_DATA
    staleness_days = (run_date - latest_data_date).days
    if staleness_days <= 2:
        return staleness_days, OK
    if staleness_days <= 7:
        return staleness_days, STALE_WARNING
    return staleness_days, STALE_DATA


def _is_true(value) -> bool:
    """Flag truthiness that never mistakes a non-empty string for True.

    `bool("False")` is True, and `astype(bool)` does the same, so a flag that
    travelled through JSON or CSV as text would silently invert its meaning.
    """
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1")
    if value is None:
        return False
    try:
        return False if pd.isna(value) else bool(value)
    except (TypeError, ValueError):
        return False


def _latest_real_date(sku_daily: pd.DataFrame, sku_id: str,
                      as_of_date: dt.date) -> Optional[dt.date]:
    """This SKU's last **real** trading day (imputed days excluded) — used for
    the freshness check."""
    sub = sku_daily[sku_daily["sku_id"].astype(str) == str(sku_id)]
    if len(sub) == 0:
        return None
    sub = sub.copy()
    sub["date"] = pd.to_datetime(sub["date"]).dt.date
    sub = sub[sub["date"] <= as_of_date]
    if len(sub) == 0:
        return None
    if "is_imputed_zero" in sub.columns:
        real = sub.loc[~sub["is_imputed_zero"].map(_is_true), "date"]
        return real.max() if len(real) else None
    return sub["date"].max()


def forecast_sku(sku_daily: pd.DataFrame, sku_id: str, as_of_date: dt.date,
                 run_date: Optional[dt.date] = None,
                 run_time: Optional[str] = None) -> dict:
    """One SKU → the 13-column output record, plus two display fields.

    `effective_n` and `level` ride alongside the contract's 13 columns because
    they are already computed here; `predict_all` drops them from the table it
    builds, so the persisted 13-column contract is unchanged.

    `as_of_date` = the **last known sales day**: features use only
    `date <= as_of_date`, and the forecast windows are
    `week1 = as_of_date+1 … +7`, `week2 = as_of_date+8 … +14`.
    No future information may ever enter the features.
    """
    if run_date is None:
        run_date = as_of_date
    if run_time is None:
        run_time = as_of_date.isoformat()

    day_vals = daily_series(sku_daily, sku_id, as_of_date)
    res = predict(day_vals)
    latest = _latest_real_date(sku_daily, sku_id, as_of_date)
    staleness_days, data_status = _check_freshness(latest, run_date)

    name_rows = sku_daily[sku_daily["sku_id"].astype(str) == str(sku_id)]
    sku_name = str(name_rows["sku_name"].iloc[0]) if len(name_rows) else ""

    return {
        "run_time": run_time,
        "cutoff_date": as_of_date.isoformat(),
        "sku_id": str(sku_id),
        "sku_name": sku_name,
        "model_id": res["model_id"],
        "forecast_week1": res["forecast_week1"],
        "forecast_week2": res["forecast_week2"],
        "forecast_14d": res["forecast_14d"],
        "history_days": res["history_days"],
        "latest_data_date": latest.isoformat() if latest else "",
        "staleness_days": staleness_days,
        "data_status": data_status,
        "forecast_status": res["forecast_status"],
        "effective_n": res["effective_n"],
        "level": res["level"],
    }


def predict_all(sku_daily: pd.DataFrame, as_of_date: Optional[dt.date] = None,
                run_date: Optional[dt.date] = None,
                run_time: Optional[str] = None) -> pd.DataFrame:
    """All SKUs → the 13-column output table.

    With `as_of_date=None` the maximum date present in `sku_daily` is used.
    """
    if sku_daily is None or len(sku_daily) == 0:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)
    if as_of_date is None:
        as_of_date = pd.to_datetime(sku_daily["date"]).max().date()

    records = [
        forecast_sku(sku_daily, sku_id, as_of_date,
                     run_date=run_date, run_time=run_time)
        for sku_id in sorted(sku_daily["sku_id"].astype(str).unique())
    ]
    return (pd.DataFrame(records, columns=OUTPUT_COLUMNS)
            .sort_values("sku_id").reset_index(drop=True))


def forecast(transactions: pd.DataFrame, as_of_date: Optional[dt.date] = None,
             run_date: Optional[dt.date] = None, run_time: Optional[str] = None,
             colmap: Optional[dict] = None
             ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convenience chain: raw transaction detail → (13-column forecast table,
    issues table).

    With `as_of_date=None` the maximum parseable date in the transaction detail
    is used.
    """
    if as_of_date is None:
        dates = transactions[_column_map(colmap)["date"]].map(_to_date).dropna()
        if len(dates) == 0:
            raise ValueError("交易明细中没有任何可解析日期，请显式传入 as_of_date")
        as_of_date = dates.max()

    valid, issues = clean_transactions(transactions, as_of_date, colmap=colmap)
    daily = build_sku_daily(valid, as_of_date)
    return predict_all(daily, as_of_date, run_date=run_date,
                       run_time=run_time), issues


# ---------------------------------------------------------------------------
# Self-check
# ---------------------------------------------------------------------------
def _self_check() -> None:  # pragma: no cover
    def series(vals):
        return pd.Series([float(v) for v in vals], dtype=float)

    # 1) Hand-computed case: [1,2,3,4] window 4 → (4·4+3·3+2·2+1·1)/10 = 3.0
    lvl, k = wma_level(series([1, 2, 3, 4]), 4)
    assert k == 4 and abs(lvl - 3.0) < 1e-12, (lvl, k)

    # 2) Constant series preserved exactly (proof of self-normalization)
    for n in (10, 28, 84, 200):
        lvl, _ = wma_level(series([13.5] * n), 84)
        assert abs(lvl - 13.5) < 1e-12, (n, lvl)

    # 3) Most recent day carries the largest weight: raising the last day moves
    #    the level more than raising the first day.
    base = [10.0] * 84
    up_last = base[:-1] + [20.0]
    up_first = [20.0] + base[1:]
    assert wma_level(series(up_last), 84)[0] > wma_level(series(up_first), 84)[0]

    # 4) Flat two-week output + non-negative
    r = predict(series([7.0] * 90))
    assert r["model_id"] == WMA_84 and r["forecast_status"] == OK
    assert r["forecast_week1"] == r["forecast_week2"] == 49.0
    assert r["forecast_14d"] == 98.0

    # 5) Fallback ladder branches
    cases = [(20, FULL_MEAN_FALLBACK, INSUFFICIENT_HISTORY),
             (40, MA_28_FALLBACK, OK),
             (70, MA_56_FALLBACK, OK),
             (90, WMA_84, OK)]
    for n, want_model, want_status in cases:
        res = predict(series([5.0] * n))
        assert res["model_id"] == want_model, (n, res["model_id"])
        assert res["forecast_status"] == want_status, (n, res["forecast_status"])
        assert abs(res["forecast_week1"] - 35.0) < 1e-9, (n, res["forecast_week1"])

    # 6) All-zero history / empty series → ALL_ZERO with 0 output
    for vals in ([], [0.0] * 100):
        res = predict(series(vals))
        assert res["forecast_status"] == ALL_ZERO, res
        assert res["forecast_week1"] == 0.0, res

    # 7) With under 84 days of history the WMA level renormalizes: a 20-day
    #    series gives the same level as its equal-weight mean.
    lvl, k = wma_level(series([3.0] * 20), 84)
    assert k == 20 and abs(lvl - 3.0) < 1e-12

    # 8) End to end: clean → SKU-Day → predict
    raw = pd.DataFrame([
        {"行号": 1, "单据日期": dt.date(2025, 1, 1), "单据类型": SALE_TYPE,
         "存货编号": "01011421", "存货全名": "测试板", "数量": 10.0},
        {"行号": 2, "单据日期": dt.date(2025, 1, 3), "单据类型": SALE_TYPE,
         "存货编号": "01011421", "存货全名": "测试板", "数量": 20.0},
        {"行号": 3, "单据日期": dt.date(2025, 1, 3), "单据类型": RETURN_TYPE,
         "存货编号": "01011421", "存货全名": "测试板", "数量": -5.0},
        {"行号": 4, "单据日期": dt.date(2025, 1, 4), "单据类型": "调拨单",
         "存货编号": "01011421", "存货全名": "测试板", "数量": 99.0},
    ])
    out, issues = forecast(raw, as_of_date=dt.date(2025, 1, 5))
    assert len(out) == 1, out
    # 5 calendar days: 1/1=10, 1/2=0, 1/3=20, 1/4=0, 1/5=0 → total 30; the
    # return does not enter sales.
    assert out["history_days"].iloc[0] == 5, out
    row = out.iloc[0]
    assert row["model_id"] == FULL_MEAN_FALLBACK, row["model_id"]
    assert abs(row["forecast_week1"] - 7.0 * 30.0 / 5.0) < 1e-9, row
    assert len(issues) == 1 and issues["reason"].iloc[0] == UNKNOWN_TRANSACTION_TYPE

    # 9) Blank dates are a data-quality issue, never a crash: NaT, NaN and ""
    #    all resolve to None → BAD_DATE, and the surviving rows still forecast.
    raw = pd.DataFrame({
        "行号": [1, 2, 3],
        "单据日期": [dt.date(2025, 1, 1), pd.NaT, ""],
        "单据类型": [SALE_TYPE] * 3, "存货编号": ["A"] * 3,
        "存货全名": ["W"] * 3, "数量": [10.0, 20.0, 30.0],
    })
    valid, issues = clean_transactions(raw, dt.date(2025, 1, 3))
    assert list(issues["reason"]) == [BAD_DATE, BAD_DATE], issues
    assert list(valid["sale"]) == [10.0], valid

    # 10) A partial colmap merges over the defaults; one SKU keeps one series
    #     even when it arrives under two names; a flag read back as text keeps
    #     its meaning; and a blank SKU is an issue row, not a phantom SKU.
    raw = pd.DataFrame({
        "行号": [1, 2, 3],
        "日期": [dt.date(2025, 1, 1), dt.date(2025, 1, 1), dt.date(2025, 1, 3)],
        "类型": [SALE_TYPE] * 3, "编号": ["A"] * 3,
        "全名": ["Widget", "Widget ", "Widget"], "数量": [10.0, 6.0, 4.0],
    })
    valid, _ = clean_transactions(raw, dt.date(2025, 1, 3), colmap={
        "date": "日期", "trade_type": "类型", "sku_id": "编号",
        "sku_name": "全名", "quantity": "数量"})
    daily = build_sku_daily(valid, dt.date(2025, 1, 3))
    assert not daily.duplicated(["sku_id", "date"]).any(), daily
    assert list(daily["sales_qty"]) == [16.0, 0.0, 4.0], daily
    assert list(daily["sku_name"].unique()) == ["Widget"], daily

    blank, blank_issues = clean_transactions(
        pd.DataFrame({"行号": [1], "单据日期": [dt.date(2025, 1, 1)],
                      "单据类型": [SALE_TYPE], "存货编号": [""],
                      "存货全名": [" "], "数量": [1.0]}),
        dt.date(2025, 1, 2))
    assert len(blank) == 0, blank
    assert blank_issues["reason"].iloc[0] == EMPTY_SKU, blank_issues

    # `is_imputed_zero` arriving as the string "false" must not read as true.
    day = {"sku_id": "A", "sku_name": "W", "return_qty": 0.0,
           "is_positive_demand": True, "source_day_status": OK,
           "data_quality_status": OK}
    daily = pd.DataFrame([
        dict(day, date=dt.date(2025, 1, 1), sales_qty=5.0, is_imputed_zero="false"),
        dict(day, date=dt.date(2025, 1, 2), sales_qty=0.0, is_imputed_zero="True"),
    ], columns=DAILY_COLUMNS)
    assert _latest_real_date(daily, "A", dt.date(2025, 1, 2)) == dt.date(2025, 1, 1)
    # The 13-column table stays 13 columns even though each record now carries
    # `effective_n` and `level` alongside.
    assert list(predict_all(daily, dt.date(2025, 1, 2)).columns) == OUTPUT_COLUMNS

    print("predict_core self-check passed (10 groups)")


if __name__ == "__main__":  # pragma: no cover
    _self_check()
