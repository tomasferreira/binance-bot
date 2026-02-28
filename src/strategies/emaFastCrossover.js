import { getEMACrossSignalPeriods } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'ema_fast_crossover'
export const name = 'EMA Fast Crossover (9/21)'
export const description =
  'Long when EMA 9 crosses above EMA 21. Short timeframe; more signals. Exits via SL/TP.'

const FAST = 9
const SLOW = 21

export function evaluate (ohlcv, state) {
  if (!Array.isArray(ohlcv) || ohlcv.length < SLOW + 2) {
    return { action: 'hold', detail: {} }
  }
  const { fast, slow, signal } = getEMACrossSignalPeriods(ohlcv, FAST, SLOW)
  const price = ohlcv[ohlcv.length - 1][4]

  if (fast == null || slow == null) {
    return { action: 'hold', detail: { fast, slow, signal } }
  }

  logger.info(
    `[${id}] price=${price.toFixed(2)} ema9=${fast.toFixed(2)} ema21=${slow.toFixed(2)} signal=${signal || 'none'}`
  )

  if (!state?.openPosition && signal === 'long') {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { fast, slow, signal } }
  }

  return { action: 'hold', detail: { fast, slow, signal } }
}
