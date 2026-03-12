import { calculateEMA, calculateRSI } from '../indicators.js'

export const id = 'short_overbought'
export const name = 'Short Overbought in Downtrend (RSI 14)'
export const description =
  'Shorts RSI(14) overbought bounces when EMA(50) < EMA(200). Exits when RSI normalizes or trend breaks.'

const RSI_PERIOD = 14
const FAST = 50
const SLOW = 200

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(SLOW, RSI_PERIOD) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const rsiArr = calculateRSI(closes, RSI_PERIOD)
  const emaFastArr = calculateEMA(closes, FAST)
  const emaSlowArr = calculateEMA(closes, SLOW)
  const i = closes.length - 1
  const prev = i - 1

  const price = closes[i]
  const rsi = rsiArr[i]
  const rsiPrev = rsiArr[prev]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if ([price, rsi, rsiPrev, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, rsi, emaFast, emaSlow } }
  }

  const trendDown = emaFast < emaSlow
  const rsiCrossIntoOverbought = rsiPrev <= 70 && rsi > 70
  const rsiNormalized = rsi < 50

  const detail = { price, rsi, emaFast, emaSlow, trendDown, rsiCrossIntoOverbought }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} RSI=${rsi.toFixed(
        2
      )} emaFast=${emaFast.toFixed(2)} emaSlow=${emaSlow.toFixed(
        2
      )} trendDown=${trendDown} overboughtCross=${rsiCrossIntoOverbought}`
    )
  }

  if (state?.openPosition?.side === 'short') {
    const exitCondition = rsiNormalized || !trendDown
    if (exitCondition) {
      if (log) log.info(`[${id}] EXIT-SHORT signal`)
      return { action: 'exit-short', detail: { ...detail, rsiNormalized } }
    }
    return { action: 'hold', detail }
  }

  if (!state?.openPosition && trendDown && rsiCrossIntoOverbought) {
    if (log) log.info(`[${id}] ENTER-SHORT on overbought bounce`)
    return { action: 'enter-short', detail }
  }

  return { action: 'hold', detail }
}

