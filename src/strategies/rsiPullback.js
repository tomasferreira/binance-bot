import { calculateEMA, calculateRSI, calculateATR } from '../indicators.js'

export const id = 'rsi_pullback'
export const name = 'RSI Pullback (14)'
export const description =
  'Long on RSI(14) pullbacks in EMA(50/200) uptrend. Exits when RSI high or trend breaks.'

const RSI_PERIOD = 14
const FAST = 50
const SLOW = 200
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2

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
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  if ([rsi, rsiPrev, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, rsi, emaFast, emaSlow } }
  }

  const trendUp = emaFast > emaSlow
  const rsiCrossUpFromOversold = rsiPrev < 30 && rsi >= 30

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} RSI=${rsi.toFixed(2)} EMA(${FAST})=${emaFast.toFixed(
        2
      )} EMA(${SLOW})=${emaSlow.toFixed(2)} trendUp=${trendUp} crossUp=${rsiCrossUpFromOversold}`
    )
  }

  if (!state?.openPosition && trendUp && rsiCrossUpFromOversold) {
    if (log) log.info(`[${id}] LONG signal`)
    return {
      action: 'enter-long',
      detail: {
        price, rsi, emaFast, emaSlow,
        stopLoss: atr != null ? price - SL_ATR_MULT * atr : undefined,
        takeProfit: atr != null ? price + TP_ATR_MULT * atr : undefined
      }
    }
  }

  if (state?.openPosition) {
    const rsiHigh = rsi >= 60
    const trendBroken = emaFast <= emaSlow
    if (rsiHigh || trendBroken) {
      if (log) log.info(`[${id}] EXIT signal`)
      return { action: 'exit-long', detail: { price, rsi, emaFast, emaSlow } }
    }
  }

  return { action: 'hold', detail: { price, rsi, emaFast, emaSlow } }
}

