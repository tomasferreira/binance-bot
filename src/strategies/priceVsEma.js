import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'price_vs_ema'
export const name = 'Price vs EMA (20)'
export const description =
  'Long when close is meaningfully above EMA(20), EMA(20) > EMA(50), and EMA(50) > EMA(200) (bullish trend). Exits when close drops below EMA(20) or below EMA(50).'

const PERIOD = 20
const TREND_PERIOD = 50
const TREND_200_PERIOD = 200
// Minimum relative distance of price above EMA(20) to open a trade (e.g. 0.001 = 0.1%)
const MIN_REL_DISTANCE = 0.001

export function evaluate (ohlcv, state) {
  const minLen = Math.max(PERIOD, TREND_PERIOD, TREND_200_PERIOD) + 1
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const ema20Arr = calculateEMA(closes, PERIOD)
  const ema50Arr = calculateEMA(closes, TREND_PERIOD)
  const ema200Arr = calculateEMA(closes, TREND_200_PERIOD)
  const i = closes.length - 1
  const price = closes[i]
  const emaVal = ema20Arr[i]
  const ema50 = ema50Arr[i]
  const ema200 = ema200Arr[i]
  if (emaVal == null || ema50 == null || ema200 == null) {
    return { action: 'hold', detail: { price, ema: emaVal ?? null, ema50: ema50 ?? null, ema200: ema200 ?? null } }
  }
  const distRel = (price - emaVal) / price
  const above = price > emaVal
  const strongAbove = above && distRel >= MIN_REL_DISTANCE
  const trendUp = emaVal > ema50
  const trendBullish = ema50 > ema200

  logger.info(
    `[${id}] price=${price.toFixed(2)} EMA(${PERIOD})=${emaVal.toFixed(
      2
    )} EMA(${TREND_PERIOD})=${ema50.toFixed(2)} EMA(${TREND_200_PERIOD})=${ema200.toFixed(
      2
    )} above=${above} strongAbove=${strongAbove} trendUp=${trendUp} trendBullish=${trendBullish}`
  )

  if (!state?.openPosition && strongAbove && trendUp && trendBullish) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, ema: emaVal, ema50, ema200 } }
  }
  if (state?.openPosition) {
    if (!above) {
      logger.info(`[${id}] EXIT signal (price < EMA20)`)
      return { action: 'exit-long', detail: { price, ema: emaVal, ema50, ema200 } }
    }
    if (price < ema50) {
      logger.info(`[${id}] EXIT signal (price < EMA50 trend break)`)
      return { action: 'exit-long', detail: { price, ema: emaVal, ema50, ema200 } }
    }
  }
  return { action: 'hold', detail: { price, ema: emaVal, ema50, ema200 } }
}
