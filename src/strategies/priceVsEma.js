import { calculateEMA, calculateATR } from '../indicators.js'

export const id = 'price_vs_ema'
export const name = 'Price vs EMA (20)'
export const description =
  'Long only after price pulls back to/near EMA(20) then closes back above it, with EMA(20) > EMA(50) and EMA(50) > EMA(200). Exits when close drops below EMA(20) or below EMA(50).'

const PERIOD = 20
const TREND_PERIOD = 50
const TREND_200_PERIOD = 200
// Minimum relative distance of price above EMA(20) to open a trade (e.g. 0.001 = 0.1%)
const MIN_REL_DISTANCE = 0.001
// Pullback entry: only long after price touched/near EMA(20) then closed back above (look back this many bars)
const PULLBACK_LOOKBACK = 10
// Price within this fraction of EMA(20) counts as "touched" (e.g. 0.002 = 0.2%)
const PULLBACK_TOUCH_MARGIN = 0.002
const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 3.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(PERIOD, TREND_PERIOD, TREND_200_PERIOD) + PULLBACK_LOOKBACK + 1
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
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  if (emaVal == null || ema50 == null || ema200 == null) {
    return { action: 'hold', detail: { price, ema: emaVal ?? null, ema50: ema50 ?? null, ema200: ema200 ?? null } }
  }
  const distRel = (price - emaVal) / price
  const above = price > emaVal
  const strongAbove = above && distRel >= MIN_REL_DISTANCE
  const trendUp = emaVal > ema50
  const trendBullish = ema50 > ema200

  // Pullback then recover: in last PULLBACK_LOOKBACK bars, at least one bar had close at or below (near) EMA 20
  let hadPullback = false
  for (let j = i - 1; j >= Math.max(0, i - PULLBACK_LOOKBACK); j--) {
    const cj = closes[j]
    const ema20j = ema20Arr[j]
    if (ema20j != null && cj != null && ema20j > 0) {
      const touchThreshold = ema20j * (1 + PULLBACK_TOUCH_MARGIN)
      if (cj <= touchThreshold) {
        hadPullback = true
        break
      }
    }
  }
  const pullbackThenAbove = hadPullback && strongAbove

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} EMA(${PERIOD})=${emaVal.toFixed(
        2
      )} EMA(${TREND_PERIOD})=${ema50.toFixed(2)} EMA(${TREND_200_PERIOD})=${ema200.toFixed(
        2
      )} above=${above} strongAbove=${strongAbove} trendUp=${trendUp} trendBullish=${trendBullish} hadPullback=${hadPullback} pullbackThenAbove=${pullbackThenAbove}`
    )
  }

  if (!state?.openPosition && pullbackThenAbove && trendUp && trendBullish) {
    if (log) log.info(`[${id}] LONG signal (pullback to EMA20 then close above + trend)`)
    return { action: 'enter-long', detail: { price, ema: emaVal, ema50, ema200, hadPullback, stopLoss: (atr != null ? price - SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price + TP_ATR_MULT * atr : undefined) } }
  }
  if (state?.openPosition) {
    if (!above) {
      if (log) log.info(`[${id}] EXIT signal (price < EMA20)`)
      return { action: 'exit-long', detail: { price, ema: emaVal, ema50, ema200 } }
    }
    if (price < ema50) {
      if (log) log.info(`[${id}] EXIT signal (price < EMA50 trend break)`)
      return { action: 'exit-long', detail: { price, ema: emaVal, ema50, ema200 } }
    }
  }
  return { action: 'hold', detail: { price, ema: emaVal, ema50, ema200 } }
}
