// Rounds to whole paise/cents — repeated floating-point money math (GST
// percentages, sums of several line totals, a subtraction of two already
// currency-scale numbers) can otherwise drift by fractions of a currency
// unit. Shared by src/services/accommodation.ts and src/services/payment.ts
// — extracted here once a second real caller needed the exact same rounding
// (directory-structure.md: "only extract to utils/ once a pattern genuinely
// repeats").
export const roundToCurrency = (amount: number): number => Math.round(amount * 100) / 100;
