import { calculateEMA } from '../indicators.js'

export const id = 'multi_ema'
export const name = 'Multi-EMA (9/21/50)'
export const description = 'Long when price > EMA9 > EMA21 > EMA50 (stacked). Exits when EMA9 crosses below EMA21.'

const P1 = 9
const P2 = 21
const P3 = 50

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  if (!Array.isArray(ohlcv) || ohlcv.length < P3 + 2) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const ema9 = calculateEMA(closes, P1)
  const ema21 = calculateEMA(closes, P2)
  const ema50 = calculateEMA(closes, P3)
  const i = closes.length - 1
  const prev = i - 1
  const e9 = ema9[i]
  const e21 = ema21[i]
  const e50 = ema50[i]
  const e9Prev = ema9[prev]
  const e21Prev = ema21[prev]
  if (e9 == null || e21 == null || e50 == null) {
    return { action: 'hold', detail: { ema9: e9, ema21: e21, ema50: e50 } }
  }
  const price = closes[i]
  const stacked = price > e9 && e9 > e21 && e21 > e50
  const exitCross = e9Prev != null && e21Prev != null && e9Prev > e21Prev && e9 < e21
  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} EMA9=${e9.toFixed(2)} EMA21=${e21.toFixed(
        2
      )} EMA50=${e50.toFixed(2)} stacked=${stacked} exitCross=${exitCross}`
    )
  }
  if (state?.openPosition && exitCross) {
    if (log) log.info(`[${id}] EXIT signal (EMA9 < EMA21)`)
    return { action: 'exit-long', detail: { price, ema9: e9, ema21: e21, ema50: e50 } }
  }
  if (!state?.openPosition && stacked) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, ema9: e9, ema21: e21, ema50: e50 } }
  }
  return { action: 'hold', detail: { ema9: e9, ema21: e21, ema50: e50 } }
}
