import { calculateMACD, calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'macd_histogram_long'
export const name = 'MACD Histogram Zero-Line (Long)'
export const description =
  'Long when MACD histogram crosses from negative to positive and price is above EMA 200. Exits via SL/TP.'

const FAST = 12
const SLOW = 26
const SIGNAL = 9
const EMA_TREND = 200

export function evaluate (ohlcv, state) {
  const minLen = SLOW + SIGNAL + EMA_TREND + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const { histogram } = calculateMACD(closes, FAST, SLOW, SIGNAL)
  const emaTrendArr = calculateEMA(closes, EMA_TREND)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = closes[i]
  const histNow = histogram[i]
  const histPrev = histogram[prev]
  const ema200 = emaTrendArr[i]

  if (histNow == null || histPrev == null || ema200 == null) {
    return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
  }

  const histogramCrossUp = histPrev < 0 && histNow >= 0
  const priceAboveEma200 = price > ema200

  logger.info(
    `[${id}] price=${price.toFixed(2)} hist=${histNow.toFixed(4)} ema200=${ema200.toFixed(2)} crossUp=${histogramCrossUp} above200=${priceAboveEma200}`
  )

  if (!state?.openPosition && histogramCrossUp && priceAboveEma200) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, histogram: histNow, ema200 } }
  }

  return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
}
