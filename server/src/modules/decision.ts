import { db, type DbClient } from "../db.js";
import { computeAvailable, listStates } from "./stateMachine.js";
import { predictSale } from "./predictor.js";
import type { Scope } from "../../../shared/model.ts";

export interface PurchaseSuggestion {
  suggestedAmount: number;
  predictedSale: number;
  available: number;
}

// Purchase strategy placeholder (docs/decision.md does not exist yet). The
// real strategy in state.md is: buy so that available covers the predicted
// sale. This is only a naive first cut — TODO(decision): replace with the
// real purchase strategy described in decision.md.
export async function suggestPurchase(
  scope: Scope,
  client: DbClient = db,
): Promise<PurchaseSuggestion> {
  const history = await listStates(scope, client);
  const latest = history[history.length - 1];
  const available = latest ? computeAvailable(latest) : 0;
  const predictedSale = predictSale(history.map((s) => s.sale));
  const suggestedAmount = Math.max(0, predictedSale - available);
  return { suggestedAmount, predictedSale, available };
}
