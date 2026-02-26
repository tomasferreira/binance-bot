import { getMACDCrossSignal } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'macd'
export const name = 'MACD (12/26/9)'
export const description = 'Goes long when MACD line crosses above the signal line. No auto-exit (relies on SL/TP).'

const FAST = 12
const SLOW = 26
const SIGNAL = 9

export function evaluate (ohlcv, state) {
  const { macd, signal: sig, histogram, crossSignal } = getMACDCrossSignal(ohlcv, FAST, SLOW, SIGNAL)
  if (macd == null || sig == null) {
    return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
  }
  logger.info(`[${id}] MACD=${macd.toFixed(4)} signal=${sig.toFixed(4)} hist=${histogram?.toFixed(4) ?? 'n/a'} cross=${crossSignal || 'none'}`)
  if (crossSignal === 'long' && !state?.openPosition) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { macd, signal: sig, crossSignal } }
  }
  return { action: 'hold', detail: { macd, signal: sig, crossSignal } }
}
