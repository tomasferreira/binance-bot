import { calculateATR } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'atr_breakout'
export const name = 'ATR Breakout (Long)'
export const description =
  'Long when close breaks above the N-period high and ATR is rising (volatility expansion). Exits via SL/TP.'

const LOOKBACK = 24 // 2h on 5m for N-period high
const ATR_PERIOD = 14
const ATR_RISE_LOOKBACK = 5

export function evaluate (ohlcv, state) {
  const minLen = Math.max(LOOKBACK, ATR_PERIOD) + ATR_RISE_LOOKBACK + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const i = ohlcv.length - 1
  const prev = i - 1
  const highPrev = Math.max(...ohlcv.slice(prev - LOOKBACK + 1, prev + 1).map(c => c[2]))
  const price = ohlcv[i][4]
  const atrArr = calculateATR(ohlcv, ATR_PERIOD)
  const atrNow = atrArr[i]
  const atrPast = atrArr[i - ATR_RISE_LOOKBACK]

  if (atrNow == null || atrPast == null) {
    return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
  }

  const breakAbove = price > highPrev
  const atrRising = atrNow > atrPast

  logger.info(
    `[${id}] price=${price.toFixed(2)} high${LOOKBACK}=${highPrev.toFixed(2)} breakAbove=${breakAbove} atrRising=${atrRising}`
  )

  if (!state?.openPosition && breakAbove && atrRising) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, highPrev, atr: atrNow } }
  }

  return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
}
