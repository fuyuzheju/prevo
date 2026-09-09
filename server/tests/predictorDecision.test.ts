import { describe, expect, it, beforeEach } from "vitest";
import { predictSale } from "../src/modules/predictor.js";
import { suggestPurchase } from "../src/modules/decision.js";
import { advanceCycle } from "../src/modules/stateMachine.js";
import { createScope, truncateAll } from "./helpers.js";

describe("predictSale (placeholder)", () => {
  it("predicts 0 without history", () => {
    expect(predictSale([])).toBe(0);
  });

  it("averages the sale history", () => {
    expect(predictSale([10, 20, 30])).toBe(20);
  });

  it("rounds to whole quantities", () => {
    expect(predictSale([5, 6])).toBe(6); // 5.5 rounds up
    expect(predictSale([1, 2])).toBe(2); // 1.5 rounds up
  });
});

describe("suggestPurchase (placeholder strategy)", () => {
  beforeEach(truncateAll);

  it("suggests nothing without any state", async () => {
    const scope = await createScope();
    await expect(suggestPurchase(scope)).resolves.toEqual({
      suggestedAmount: 0,
      predictedSale: 0,
      available: 0,
    });
  });

  it("uses available and predicted sale from the history", async () => {
    const scope = await createScope();
    // cycle 1: sale 300 bought nothing shipped nothing => available = -300
    await advanceCycle(scope, { sent: 0, received: 0, sale: 300, purchase: 0 });
    const suggestion = await suggestPurchase(scope);
    expect(suggestion.predictedSale).toBe(300);
    expect(suggestion.available).toBe(-300);
    expect(suggestion.suggestedAmount).toBe(600);
  });

  it("suggests nothing when available covers the predicted sale", async () => {
    const scope = await createScope();
    // plenty of stock: inventory 300, transit nets zero => available = 200
    await advanceCycle(scope, { sent: 0, received: 300, sale: 100, purchase: 300 });
    const suggestion = await suggestPurchase(scope);
    expect(suggestion.available).toBe(200);
    expect(suggestion.suggestedAmount).toBe(0);
  });
});
