// Sale predictor. Not specified in detail yet (docs/predictor.md): this is a
// placeholder that takes the per-cycle sale history of a scope and returns a
// predicted sale quantity for the next cycle.
//
// TODO(predictor): replace with the real prediction model once predictor.md
// exists. Only the signature below is part of the framework contract.
export function predictSale(pastSales: readonly number[]): number {
  if (pastSales.length === 0) return 0;
  const total = pastSales.reduce((sum, sale) => sum + sale, 0);
  const average = Math.round(total / pastSales.length);
  return Math.max(0, average);
}
