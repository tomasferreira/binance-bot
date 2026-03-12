import { getMACDCrossSignal } from '../indicators.js'

export const id = 'macd'
export const name = 'MACD (12/26/9)'
export const description = 'Goes long when MACD line crosses above the signal line. Exits when MACD crosses below signal; otherwise SL/TP.'

const FAST = 12
const SLOW = 26
const SIGNAL = 9

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const { macd, signal: sig, histogram, crossSignal } = getMACDCrossSignal(ohlcv, FAST, SLOW, SIGNAL)
  if (macd == null || sig == null) {
    return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
  }
  if (log) {
    log.info(
      `[${id}] MACD=${macd.toFixed(4)} signal=${sig.toFixed(4)} hist=${histogram?.toFixed(4) ?? 'n/a'} cross=${crossSignal || 'none'}`
    )
  }
  if (crossSignal === 'long' && !state?.openPosition) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { macd, signal: sig, crossSignal } }
  }
  if (state?.openPosition && crossSignal === 'short') {
    if (log) log.info(`[${id}] EXIT signal (MACD cross below signal)`)
    return { action: 'exit-long', detail: { macd, signal: sig, crossSignal } }
  }
  return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
}
