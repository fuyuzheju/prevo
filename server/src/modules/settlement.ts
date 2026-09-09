import { db } from "../db.js";
import { settlePendingByDay } from "./stateSummary.js";

const DEFAULT_SETTLE_TIME = "00:05";

export interface SettleTime {
  hour: number;
  minute: number;
}

const SETTLE_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// Daily settlement moment, from SETTLE_TIME (HH:MM, server local time).
// Fails loudly on a bad configuration so startup exposes it immediately.
export function parseSettleTime(raw: string | undefined = process.env.SETTLE_TIME): SettleTime {
  const value = (raw ?? DEFAULT_SETTLE_TIME).trim();
  const match = SETTLE_TIME_RE.exec(value);
  if (!match) {
    throw new Error(`invalid SETTLE_TIME "${value}", expected HH:MM like "00:05"`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function msUntilNextSettle(now: Date, time: SettleTime): number {
  const next = new Date(now);
  next.setHours(time.hour, time.minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

// Settle every scope that has pending records; each scope's pending records
// are folded per local calendar day (see settlePendingByDay). Returns the
// total number of cycles created.
export async function runDailySettlement(): Promise<number> {
  const scopes = await db.scopeRecord.groupBy({
    by: ["userId", "productId"],
    where: { cycle: null },
  });
  let cycles = 0;
  for (const { userId, productId } of scopes) {
    cycles += await settlePendingByDay({ userId, productId });
  }
  return cycles;
}

export interface SettlementHandle {
  stop: () => void;
}

// Runs runDailySettlement at the configured local time every day while the
// process is up. Missed runs (downtime) are caught up by settlePendingByDay's
// per-day grouping. Single-flight: never two settlements at once.
export function scheduleDailySettlement(
  settle: () => Promise<number> = runDailySettlement,
): SettlementHandle {
  const time = parseSettleTime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;

  const scheduleNext = () => {
    timer = setTimeout(run, msUntilNextSettle(new Date(), time));
    timer.unref?.();
  };

  const run = async () => {
    if (running || stopped) {
      if (!stopped) scheduleNext();
      return;
    }
    running = true;
    try {
      const cycles = await settle();
      if (cycles > 0) {
        console.log(`[settlement] ${new Date().toISOString()} settled ${cycles} cycle(s)`);
      }
    } catch (error) {
      console.error("[settlement] run failed:", error);
    } finally {
      running = false;
      if (!stopped) scheduleNext();
    }
  };

  scheduleNext();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
