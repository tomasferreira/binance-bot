import { calculateStochastic, calculateATR } from '../indicators.js'

export const id = 'stochastic_oversold'
export const name = 'Stochastic Oversold (Long)'
export const description =
  'Long when %K crosses above %D from below 20 (oversold). Exits when %K crosses below %D or RSI-style exit optional.'

const K_PERIOD = 14
const D_PERIOD = 3
const OVERSOLD = 20
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = K_PERIOD + D_PERIOD + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const { k, d } = calculateStochastic(ohlcv, K_PERIOD, D_PERIOD)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = ohlcv[i][4]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  const kNow = k[i]
  const dNow = d[i]
  const kPrev = k[prev]
  const dPrev = d[prev]

  if (kNow == null || dNow == null || kPrev == null || dPrev == null) {
    return { action: 'hold', detail: { price, k: kNow, d: dNow } }
  }

  const wasOversold = kPrev < OVERSOLD
  const crossUp = kPrev <= dPrev && kNow > dNow
  const longSignal = wasOversold && crossUp

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
      )} %D=${dNow.toFixed(2)} wasOversold=${wasOversold} crossUp=${crossUp}`
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
