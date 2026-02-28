import { config } from './config.js'

/**
 * Effective risk/SL/TP from state.runtimeConfig with fallbacks to env config.
 * @param {object} state - Strategy state (may have runtimeConfig)
 * @returns {{ riskPerTrade: number, stopLossPct: number, takeProfitPct: number }}
 */
export function getEffectiveTradingConfig (state) {
  const runtime = state?.runtimeConfig || {}
  const riskPerTrade =
    typeof runtime.riskPerTrade === 'number' && runtime.riskPerTrade > 0
      ? runtime.riskPerTrade
      : config.trading.riskPerTrade
  const stopLossPct =
    typeof runtime.stopLossPct === 'number' && runtime.stopLossPct > 0
      ? runtime.stopLossPct
      : config.trading.stopLossPct
  const takeProfitPct =
    typeof runtime.takeProfitPct === 'number' && runtime.takeProfitPct > 0
      ? runtime.takeProfitPct
      : config.trading.takeProfitPct
  return { riskPerTrade, stopLossPct, takeProfitPct }
}

/**
 * Unrealized PnL for an open position at a given mark price.
 * @param {{ side: string, entryPrice: number, amount: number }} position
 * @param {number} lastPrice
 * @returns {number}
 */
export function computeUnrealizedPnl (position, lastPrice) {
  if (!position || lastPrice == null) return 0
  const { side, entryPrice, amount } = position
  if (side === 'long') return (lastPrice - entryPrice) * amount
  if (side === 'short') return (entryPrice - lastPrice) * amount
  return 0
}
