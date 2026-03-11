import { calculateDonchian, calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'donchian_breakout'
export const name = 'Donchian Channel Breakout (Long)'
export const description =
  'Long when close breaks above the highest high of the last N periods, above EMA 50. Exits when price closes below EMA 50; otherwise SL/TP.'

const DONCHIAN_PERIOD = 20
const EMA_TREND = 50

export function evaluate (ohlcv, state) {
  const minLen = Math.max(DONCHIAN_PERIOD, EMA_TREND) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const { upper, lower } = calculateDonchian(ohlcv, DONCHIAN_PERIOD)
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, EMA_TREND)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = closes[i]
  const upperPrev = upper[prev]
  const upperNow = upper[i]
  const ema50 = emaArr[i]

  if (upperPrev == null || upperNow == null) {
    return { action: 'hold', detail: { price, upper: upperNow } }
  }

  const breakAbove = price > upperPrev
  const aboveEma50 = ema50 != null && price > ema50

  logger.info(
    `[${id}] price=${price.toFixed(2)} donchianUpper=${upperPrev.toFixed(2)} breakAbove=${breakAbove} aboveEma50=${aboveEma50}`
  )

  if (!state?.openPosition && breakAbove && aboveEma50) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, upper: upperPrev, ema50 } }
  }
  if (state?.openPosition && ema50 != null && price < ema50) {
    logger.info(`[${id}] EXIT signal (price below EMA 50)`)
    return { action: 'exit-long', detail: { price, upper: upperNow, ema50 } }
  }

  return { action: 'hold', detail: { price, upper: upperNow } }
}
