import { calculateStochastic, calculateATR, calculateEMA } from '../indicators.js'

export const id = 'stochastic_oversold'
export const name = 'Stochastic Oversold (Long)'
export const description =
  'Long when %K crosses above %D from below 20 (oversold) and EMA 50 >= EMA 200 (uptrend). Exits when %K crosses below %D.'

const K_PERIOD = 14
const D_PERIOD = 3
const OVERSOLD = 20
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2
const EMA_FAST = 50
const EMA_SLOW = 200

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(K_PERIOD + D_PERIOD, EMA_SLOW) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const { k, d } = calculateStochastic(ohlcv, K_PERIOD, D_PERIOD)
  const closes = ohlcv.map(c => c[4])
  const emaFastArr = calculateEMA(closes, EMA_FAST)
  const emaSlowArr = calculateEMA(closes, EMA_SLOW)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = ohlcv[i][4]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  const kNow = k[i]
  const dNow = d[i]
  const kPrev = k[prev]
  const dPrev = d[prev]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if (kNow == null || dNow == null || kPrev == null || dPrev == null) {
    return { action: 'hold', detail: { price, k: kNow, d: dNow } }
  }

  const wasOversold = kPrev < OVERSOLD
  const crossUp = kPrev <= dPrev && kNow > dNow
  const trendUp = emaFast != null && emaSlow != null && emaFast >= emaSlow
  const longSignal = wasOversold && crossUp && trendUp

  if (state?.openPosition) {
    const crossDown = kPrev >= dPrev && kNow < dNow
    if (crossDown) {
      if (log) log.info(`[${id}] EXIT signal (Stoch cross down)`)
      return { action: 'exit-long', detail: { price, k: kNow, d: dNow } }
    }
    return { action: 'hold', detail: { price, k: kNow, d: dNow } }
  }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} %K=${kNow.toFixed(
        2
      )} %D=${dNow.toFixed(2)} wasOversold=${wasOversold} crossUp=${crossUp} trendUp=${trendUp}`
    )
  }

  if (longSignal) {
    if (log) log.info(`[${id}] LONG signal`)
    return {
      action: 'enter-long',
      detail: {
        price, k: kNow, d: dNow,
        stopLoss: atr != null ? price - SL_ATR_MULT * atr : undefined,
        takeProfit: atr != null ? price + TP_ATR_MULT * atr : undefined
      }
    }
  }

  return { action: 'hold', detail: { price, k: kNow, d: dNow } }
}
