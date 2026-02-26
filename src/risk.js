import { logger } from './logger.js'

// Compute position size in base currency units based on risk percentage,
// stop loss distance, account balance, and optional fee (round-trip).
// Total loss at SL = price move + fee on entry + fee on exit.
export function calculatePositionSize ({
  balanceQuote,
  entryPrice,
  stopLossPrice,
  riskPerTrade,
  feeRatePct = 0
}) {
  if (!balanceQuote || !entryPrice || !stopLossPrice || !riskPerTrade) {
    logger.warn('Invalid parameters for position sizing')
    return 0
  }

  const riskAmount = balanceQuote * riskPerTrade
  const stopDistance = Math.abs(entryPrice - stopLossPrice)

  if (stopDistance <= 0) {
    logger.warn('Stop loss distance must be positive')
    return 0
  }

  // Loss per unit at SL = (entry - SL) + fee on entry + fee on exit (in quote per unit)
  const feePerUnit = typeof feeRatePct === 'number' && feeRatePct > 0
    ? feeRatePct * (entryPrice + stopLossPrice)
    : 0
  const lossPerUnit = stopDistance + feePerUnit

  const positionSizeBase = riskAmount / lossPerUnit
  if (!isFinite(positionSizeBase) || positionSizeBase <= 0) {
    logger.warn('Calculated non-positive position size')
    return 0
  }

  // Round down to 6 decimal places for safety
  const rounded = Math.floor(positionSizeBase * 1e6) / 1e6
  return rounded
}

