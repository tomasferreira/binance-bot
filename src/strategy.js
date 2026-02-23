import { getEMACrossSignal } from './indicators.js'
import { logger } from './logger.js'
import { config } from './config.js'

const { testingMode } = config.trading

// High-level strategy wrapper for EMA 50 / EMA 200
export function evaluateStrategy ({ ohlcv, lastState }) {
  // Pure “force trade” test mode: enter long whenever flat
  if (testingMode && !lastState?.openPosition) {
    logger.info('TESTING_MODE enabled: forcing LONG entry regardless of strategy')
    return { action: 'enter-long', fast: null, slow: null }
  }

  const { fast, slow, signal } = getEMACrossSignal(ohlcv)

  logger.info(
    `EMA Status - fast(50): ${fast?.toFixed?.(2) ?? 'n/a'}, slow(200): ${slow?.toFixed?.(
      2
    ) ?? 'n/a'}, signal: ${signal || 'none'}`
  )

  // Only take long trades in this simple implementation
  if (!testingMode && signal === 'long' && lastState?.openPosition == null) {
    logger.info('Generated LONG entry signal from EMA crossover')
    return { action: 'enter-long', fast, slow }
  }

  // For now, ignore short entries; you could extend this to short selling.
  return { action: 'hold', fast, slow }
}

