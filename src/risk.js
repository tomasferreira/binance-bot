import { logger } from './logger.js'

// Compute position size in base currency units based on risk percentage,
// stop loss distance, and account balance in quote currency.
export function calculatePositionSize ({
  balanceQuote,
  entryPrice,
  stopLossPrice,
  riskPerTrade
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

  const positionSizeBase = riskAmount / stopDistance
  if (!isFinite(positionSizeBase) || positionSizeBase <= 0) {
    logger.warn('Calculated non-positive position size')
    return 0
  }

  // Round down to 6 decimal places for safety
  const rounded = Math.floor(positionSizeBase * 1e6) / 1e6
  return rounded
}

