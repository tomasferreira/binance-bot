import { calculateATR, calculateBollinger, calculateEMA } from '../indicators.js'

export const id = 'bb_squeeze'
export const name = 'Bollinger Squeeze Breakout (Long)'
export const description =
  'Long when BB width has been low (squeeze) and price breaks above the upper band. Exits when price closes below EMA 50; otherwise SL/TP.'

const PERIOD = 20
const K = 2
const WIDTH_LOOKBACK = 50
const TREND_EMA = 50
const WIDTH_PERCENTILE = 20 // squeeze = width in bottom 20% of recent
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(PERIOD, WIDTH_LOOKBACK, TREND_EMA) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, TREND_EMA)
  const { upper, lower } = calculateBollinger(closes, PERIOD, K)
  const i = closes.length - 1
  const prev = i - 1
  const price = closes[i]
  const pricePrev = closes[prev]
  const upperNow = upper[i]
  const lowerNow = lower[i]
  const ema50 = emaArr[i]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]

  if (upperNow == null || lowerNow == null) {
    return { action: 'hold', detail: { price, upper: upperNow, lower: lowerNow } }
  }

  const width = upperNow - lowerNow
  const widths = []
  for (let j = Math.max(0, i - WIDTH_LOOKBACK); j <= i; j++) {
    if (upper[j] != null && lower[j] != null) {
      widths.push(upper[j] - lower[j])
    }
  }
  widths.sort((a, b) => a - b)
  const threshold = widths[Math.floor(widths.length * (WIDTH_PERCENTILE / 100))] ?? width
  const squeeze = width <= threshold
  const breakAboveUpper = pricePrev <= upper[prev] && price > upperNow

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} upper=${upperNow.toFixed(
        2
      )} width=${width.toFixed(2)} squeeze=${squeeze} breakAbove=${breakAboveUpper}`
    )
  }

  if (!state?.openPosition && squeeze && breakAboveUpper) {
    if (log) log.info(`[${id}] LONG signal (squeeze breakout)`)
    return { action: 'enter-long', detail: { price, upper: upperNow, lower: lowerNow, width, stopLoss: (atr != null ? price - SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price + TP_ATR_MULT * atr : undefined) } }
  }
  if (state?.openPosition && ema50 != null && price < ema50) {
    if (log) log.info(`[${id}] EXIT signal (price below EMA 50)`)
    return { action: 'exit-long', detail: { price, upper: upperNow, lower: lowerNow, ema50 } }
  }

  return { action: 'hold', detail: { price, upper: upperNow, lower: lowerNow, width } }
}
