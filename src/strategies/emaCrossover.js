import { getEMACrossSignal, calculateATR } from '../indicators.js'

export const id = 'ema_crossover'
export const name = 'EMA Crossover (50/200)'
export const description = 'Goes long when EMA 50 crosses above EMA 200. Exits when EMA 50 crosses below EMA 200; otherwise SL/TP.'

const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 3.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const { fast, slow, signal } = getEMACrossSignal(ohlcv)
  const price = ohlcv[ohlcv.length - 1][4]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
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
    return { action: 'enter-long', detail: { fast, slow, signal, stopLoss: (atr != null ? price - SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price + TP_ATR_MULT * atr : undefined) } }
  }
  if (state?.openPosition && signal === 'short') {
    if (log) log.info(`[${id}] EXIT signal (EMA 50 cross below 200)`)
    return { action: 'exit-long', detail: { fast, slow, signal } }
  }
  return { action: 'hold', detail: { fast, slow, signal } }
}
