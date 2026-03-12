import { getMACDCrossSignal, calculateATR } from '../indicators.js'

export const id = 'macd'
export const name = 'MACD (12/26/9)'
export const description = 'Goes long when MACD line crosses above the signal line. Exits when MACD crosses below signal; otherwise SL/TP.'

const FAST = 12
const SLOW = 26
const SIGNAL = 9
const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 3.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  if (!Array.isArray(ohlcv) || ohlcv.length < SLOW + SIGNAL + 2) {
    return { action: 'hold', detail: {} }
  }
  const { macd, signal: sig, histogram, crossSignal } = getMACDCrossSignal(ohlcv, FAST, SLOW, SIGNAL)
  if (macd == null || sig == null) {
    return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
  }
  const price = ohlcv[ohlcv.length - 1][4]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  if (log) {
    log.info(
      `[${id}] MACD=${macd.toFixed(4)} signal=${sig.toFixed(4)} hist=${histogram?.toFixed(4) ?? 'n/a'} cross=${crossSignal || 'none'}`
    )
  }
  if (crossSignal === 'long' && !state?.openPosition) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { macd, signal: sig, crossSignal, stopLoss: (atr != null ? price - SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price + TP_ATR_MULT * atr : undefined) } }
  }
  if (state?.openPosition && crossSignal === 'short') {
    if (log) log.info(`[${id}] EXIT signal (MACD cross below signal)`)
    return { action: 'exit-long', detail: { macd, signal: sig, crossSignal } }
  }
  return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
}
