// EMA calculation and crossover helpers

export function calculateEMA (values, period) {
  if (!Array.isArray(values) || values.length < period) return []

  const k = 2 / (period + 1)
  const ema = []

  // Start with SMA for the first value
  const firstSlice = values.slice(0, period)
  const sma =
    firstSlice.reduce((sum, v) => sum + v, 0) / period
  ema[period - 1] = sma

  // Continue with EMA
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k)
  }

  return ema
}

export function getEMACrossSignal (ohlcv) {
  // ohlcv: [ [timestamp, open, high, low, close, volume], ... ]
  if (!Array.isArray(ohlcv) || ohlcv.length < 210) {
    return { fast: null, slow: null, signal: null }
  }

  const closes = ohlcv.map(c => c[4])

  const fastPeriod = 50
  const slowPeriod = 200

  const fastEma = calculateEMA(closes, fastPeriod)
  const slowEma = calculateEMA(closes, slowPeriod)

  const lastIndex = closes.length - 1
  const prevIndex = lastIndex - 1

  const fastNow = fastEma[lastIndex]
  const slowNow = slowEma[lastIndex]
  const fastPrev = fastEma[prevIndex]
  const slowPrev = slowEma[prevIndex]

  if (
    fastNow == null ||
    slowNow == null ||
    fastPrev == null ||
    slowPrev == null
  ) {
    return { fast: null, slow: null, signal: null }
  }

  // Crossover logic
  if (fastPrev < slowPrev && fastNow > slowNow) {
    return { fast: fastNow, slow: slowNow, signal: 'long' }
  }

  if (fastPrev > slowPrev && fastNow < slowNow) {
    return { fast: fastNow, slow: slowNow, signal: 'short' }
  }

  return { fast: fastNow, slow: slowNow, signal: null }
}

