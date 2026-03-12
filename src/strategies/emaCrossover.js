import { getEMACrossSignal } from '../indicators.js'

export const id = 'ema_crossover'
export const name = 'EMA Crossover (50/200)'
export const description = 'Goes long when EMA 50 crosses above EMA 200. Exits when EMA 50 crosses below EMA 200; otherwise SL/TP.'

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const { fast, slow, signal } = getEMACrossSignal(ohlcv)
  if (fast == null || slow == null) {
    return { action: 'hold', detail: { fast, slow, signal } }
  }
  if (log) {
    log.info(
      `[${id}] EMA fast(50)=${fast.toFixed(2)} slow(200)=${slow.toFixed(2)} signal=${signal || 'none'}`
    )
  }
  if (signal === 'long' && !state?.openPosition) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { fast, slow, signal } }
  }
  if (state?.openPosition && signal === 'short') {
    if (log) log.info(`[${id}] EXIT signal (EMA 50 cross below 200)`)
    return { action: 'exit-long', detail: { fast, slow, signal } }
  }
  return { action: 'hold', detail: { fast, slow, signal } }
}
