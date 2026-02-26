import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'price_vs_ema'
export const name = 'Price vs EMA (20)'
export const description =
  'Long when close is meaningfully above EMA(20) and EMA(20) is above EMA(50). Exits when close drops below EMA(20).'

const PERIOD = 20
const TREND_PERIOD = 50
// Minimum relative distance of price above EMA(20) to open a trade (e.g. 0.001 = 0.1%)
const MIN_REL_DISTANCE = 0.001

export function evaluate (ohlcv, state) {
  const minLen = Math.max(PERIOD, TREND_PERIOD) + 1
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const ema20Arr = calculateEMA(closes, PERIOD)
  const ema50Arr = calculateEMA(closes, TREND_PERIOD)
  const i = closes.length - 1
  const price = closes[i]
  const emaVal = ema20Arr[i]
  const ema50 = ema50Arr[i]
  if (emaVal == null || ema50 == null) {
    return { action: 'hold', detail: { price, ema: emaVal ?? null, ema50: ema50 ?? null } }
  }
  const distRel = (price - emaVal) / price
  const above = price > emaVal
  const strongAbove = above && distRel >= MIN_REL_DISTANCE
  const trendUp = emaVal > ema50

  logger.info(
    `[${id}] price=${price.toFixed(2)} EMA(${PERIOD})=${emaVal.toFixed(
      2
    )} EMA(${TREND_PERIOD})=${ema50.toFixed(2)} above=${above} strongAbove=${strongAbove} trendUp=${trendUp}`
  )

  if (!state?.openPosition && strongAbove && trendUp) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, ema: emaVal, ema50 } }
  }
  if (state?.openPosition && !above) {
    logger.info(`[${id}] EXIT signal (price < EMA)`)
    return { action: 'exit-long', detail: { price, ema: emaVal, ema50 } }
  }
  return { action: 'hold', detail: { price, ema: emaVal, ema50 } }
}
