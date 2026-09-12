// Fixed-point quantities, shared by server and client. Every amount that
// reaches the ledger, the state machine or a prediction series is an integer
// number of 1/QUANTITY_SCALE units (so 0.5 is stored as 500). Converting to
// and from the decimal numbers users type or see happens only at the edges:
// input fields, Excel import and display formatting.
//
// Amounts are ordinary signed integers: 0 and negative values are valid and
// flow through the linear formulas without special cases. Business-wise a
// negative amount reverses the flow of its record kind (a customer return as
// a negative SELL, a return to the supplier as a negative PURCHASE/RECEIVE
// pair), and 0 is a no-op record.

export const QUANTITY_SCALE = 1000;

// Valid in the database / on the wire: a safe integer number of 1/1000 units.
export function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

const QUANTITY_INPUT_RE = /^([+-]?)(?:(\d+)(?:\.(\d{0,3}))?|\.(\d{1,3}))$/;

// Human input (a form field or an Excel cell) → scaled integer, or null when
// invalid. More than 3 decimals are rejected instead of silently rounded, so
// imported numbers are never altered.
export function parseQuantity(input: string | number): number | null {
  const text = typeof input === "number" ? String(input) : input;
  const match = QUANTITY_INPUT_RE.exec(text.replace(/,/g, "").trim());
  if (!match) return null;
  const whole = Number(match[2] ?? "0");
  const fraction = Number((match[3] ?? match[4] ?? "").padEnd(3, "0"));
  const magnitude = whole * QUANTITY_SCALE + fraction;
  if (!Number.isSafeInteger(magnitude)) return null;
  if (magnitude === 0) return 0;
  return match[1] === "-" ? -magnitude : magnitude;
}

// Scaled integer → the shortest decimal string that represents it exactly:
// 500 → "0.5", -1500 → "-1.5", 1000 → "1", 1 → "0.001".
export function formatQuantity(value: number): string {
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude / QUANTITY_SCALE);
  const fraction = String(magnitude % QUANTITY_SCALE)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
