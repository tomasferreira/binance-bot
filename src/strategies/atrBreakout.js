import { calculateATR, calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'atr_breakout'
export const name = 'ATR Breakout (Long)'
export const description =
  'Long when close breaks above the N-period high (two-bar confirmation) and ATR is rising. Exits when price closes below EMA 20; otherwise SL/TP.'

const LOOKBACK = 24 // 2h on 5m for N-period high
const ATR_PERIOD = 14
const ATR_RISE_LOOKBACK = 5
const TREND_EMA = 20

export function evaluate (ohlcv, state) {
  const minLen = Math.max(LOOKBACK, ATR_PERIOD, TREND_EMA) + ATR_RISE_LOOKBACK + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const i = ohlcv.length - 1
  const prev = i - 1
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, TREND_EMA)
  const ema20 = emaArr[i]
  const highPrev = Math.max(...ohlcv.slice(prev - LOOKBACK + 1, prev + 1).map(c => c[2]))
  const price = ohlcv[i][4]
  const prevClose = ohlcv[prev][4]
  const atrArr = calculateATR(ohlcv, ATR_PERIOD)
  const atrNow = atrArr[i]
  const atrPast = atrArr[i - ATR_RISE_LOOKBACK]

  if (atrNow == null || atrPast == null) {
    return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
  }

  const atrRising = atrNow > atrPast
  const bothClosesAbove = prevClose > highPrev && price > highPrev

  logger.info(
    `[${id}] price=${price.toFixed(2)} prevClose=${prevClose.toFixed(2)} high${LOOKBACK}=${highPrev.toFixed(2)} bothAbove=${bothClosesAbove} atrRising=${atrRising}`
  )

  if (!state?.openPosition && bothClosesAbove && atrRising) {
    logger.info(`[${id}] LONG signal (two-bar close above + ATR rising)`)
    return { action: 'enter-long', detail: { price, highPrev, prevClose, atr: atrNow } }
  }
  if (state?.openPosition && ema20 != null && price < ema20) {
    logger.info(`[${id}] EXIT signal (price below EMA 20)`)
    return { action: 'exit-long', detail: { price, highPrev, atr: atrNow, ema20 } }
  }

  return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
}
