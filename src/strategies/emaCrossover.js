import { getEMACrossSignal } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'ema_crossover'
export const name = 'EMA Crossover (50/200)'
export const description = 'Goes long when EMA 50 crosses above EMA 200. No auto-exit (relies on SL/TP).'

export function evaluate (ohlcv, state) {
  const { fast, slow, signal } = getEMACrossSignal(ohlcv)
  if (fast == null || slow == null) {
    return { action: 'hold', detail: { fast, slow, signal } }
  }
  logger.info(`[${id}] EMA fast(50)=${fast.toFixed(2)} slow(200)=${slow.toFixed(2)} signal=${signal || 'none'}`)
  if (signal === 'long' && !state?.openPosition) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { fast, slow, signal } }
  }
  return { action: 'hold', detail: { fast, slow, signal } }
}
