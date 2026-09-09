import { db, type DbClient } from "../db.js";
import { getLatestState } from "./stateMachine.js";
import { forecastNext14Days, type TwoWeekForecast } from "./predictor.js";
import { buildDailySalesSeries, type SalesDay } from "./salesHistory.js";
import {
  applyPendingToPosition,
  availableOf,
  isRecordKind,
  type RecordKind,
  type Scope,
} from "../../../shared/model.ts";

// Purchase decision (docs/decision.md): buy so that the live available
// position covers the safety stock, where the safety stock is the predicted
// total sales of the next two weeks.

export interface PurchaseDecision {
  available: number;
  safetyStock: number;
  suggestedAmount: number;
  forecast: TwoWeekForecast;
}

type PositionDb = Pick<DbClient, "cycleState" | "scopeRecord">;

function emptyPendingByKind(): Record<RecordKind, number> {
  return { PURCHASE: 0, SELL: 0, SEND: 0, RECEIVE: 0 };
}

// Live position = latest settled snapshot extrapolated through the pending
// records (same math the client shows on the query page).
export async function getLivePosition(
  scope: Scope,
  client: PositionDb = db,
): Promise<{ inventory: number; soldTransit: number; boughtTransit: number; available: number }> {
  const [snapshot, records] = await Promise.all([
    getLatestState(scope, client),
    client.scopeRecord.findMany({
      where: { userId: scope.userId, productType: scope.productType, cycle: null },
      select: { kind: true, amount: true },
    }),
  ]);
  const base = snapshot
    ? { inventory: snapshot.inventory, soldTransit: snapshot.soldTransit, boughtTransit: snapshot.boughtTransit }
    : { inventory: 0, soldTransit: 0, boughtTransit: 0 };
  const byKind = emptyPendingByKind();
  for (const row of records) {
    if (isRecordKind(row.kind)) byKind[row.kind] += row.amount;
  }
  const position = applyPendingToPosition(base, byKind);
  return { ...position, available: availableOf(position) };
}

export async function decidePurchase(
  scope: Scope,
  client: DbClient = db,
): Promise<PurchaseDecision & { series: SalesDay[] }> {
  const [series, position] = await Promise.all([
    buildDailySalesSeries(scope, client),
    getLivePosition(scope, client),
  ]);
  const forecast = forecastNext14Days(series.map((day) => ({ total: day.sale })));
  const safetyStock = forecast.predictedTotal;
  const suggestedAmount = Math.max(0, safetyStock - position.available);
  return { available: position.available, safetyStock, suggestedAmount, forecast, series };
}
