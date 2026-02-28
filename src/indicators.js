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

/** EMA crossover with configurable periods. */
export function getEMACrossSignalPeriods (ohlcv, fastPeriod = 50, slowPeriod = 200) {
  if (!Array.isArray(ohlcv) || ohlcv.length < slowPeriod + 2) {
    return { fast: null, slow: null, signal: null }
  }
  const closes = ohlcv.map(c => c[4])
  const fastEma = calculateEMA(closes, fastPeriod)
  const slowEma = calculateEMA(closes, slowPeriod)
  const lastIndex = closes.length - 1
  const prevIndex = lastIndex - 1
  const fastNow = fastEma[lastIndex]
  const slowNow = slowEma[lastIndex]
  const fastPrev = fastEma[prevIndex]
  const slowPrev = slowEma[prevIndex]
  if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) {
    return { fast: null, slow: null, signal: null }
  }
  if (fastPrev < slowPrev && fastNow > slowNow) return { fast: fastNow, slow: slowNow, signal: 'long' }
  if (fastPrev > slowPrev && fastNow < slowNow) return { fast: fastNow, slow: slowNow, signal: 'short' }
  return { fast: fastNow, slow: slowNow, signal: null }
}

/** Average volume over last N candles. ohlcv[i][5] = volume. */
export function averageVolume (ohlcv, period = 20) {
  if (!Array.isArray(ohlcv) || ohlcv.length < period) return null
  const vols = ohlcv.slice(-period).map(c => c[5] ?? 0)
  return vols.reduce((a, b) => a + b, 0) / period
}

/** Donchian channel: upper = highest high, lower = lowest low over last N. */
export function calculateDonchian (ohlcv, period = 20) {
  if (!Array.isArray(ohlcv) || ohlcv.length < period) {
    return { upper: [], lower: [] }
  }
  const n = ohlcv.length
  const upper = new Array(n).fill(null)
  const lower = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    const slice = ohlcv.slice(i - period + 1, i + 1)
    upper[i] = Math.max(...slice.map(c => c[2]))
    lower[i] = Math.min(...slice.map(c => c[3]))
  }
  return { upper, lower }
}

/** Stochastic %K and %D. ohlcv: [..., open, high, low, close, volume] => 2=high, 3=low, 4=close. */
export function calculateStochastic (ohlcv, kPeriod = 14, dPeriod = 3) {
  if (!Array.isArray(ohlcv) || ohlcv.length < kPeriod + dPeriod) {
    return { k: [], d: [] }
  }
  const n = ohlcv.length
  const k = new Array(n).fill(null)
  for (let i = kPeriod - 1; i < n; i++) {
    const slice = ohlcv.slice(i - kPeriod + 1, i + 1)
    const high = Math.max(...slice.map(c => c[2]))
    const low = Math.min(...slice.map(c => c[3]))
    const close = ohlcv[i][4]
    if (high === low) {
      k[i] = 50
    } else {
      k[i] = 100 * (close - low) / (high - low)
    }
  }
  const d = new Array(n).fill(null)
  for (let i = kPeriod - 1 + dPeriod - 1; i < n; i++) {
    const kSlice = k.slice(i - dPeriod + 1, i + 1).filter(v => v != null)
    if (kSlice.length === dPeriod) {
      d[i] = kSlice.reduce((a, b) => a + b, 0) / dPeriod
    }
  }
  return { k, d }
}

// MACD: line = EMA(fast) - EMA(slow), signal = EMA(macdLine, signalPeriod)
export function calculateMACD (closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(closes) || closes.length < slowPeriod + signalPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] }
  }
  const fastEma = calculateEMA(closes, fastPeriod)
  const slowEma = calculateEMA(closes, slowPeriod)
  const macdLine = closes.map((_, i) => {
    if (fastEma[i] == null || slowEma[i] == null) return null
    return fastEma[i] - slowEma[i]
  })
  const start = slowPeriod - 1
  const macdValues = []
  for (let i = start; i < macdLine.length; i++) {
    if (macdLine[i] != null) macdValues.push(macdLine[i])
  }
  if (macdValues.length < signalPeriod) {
    return { macdLine, signalLine: macdLine.map(() => null), histogram: macdLine.map(() => null) }
  }
  const signalEma = calculateEMA(macdValues, signalPeriod)
  const signalLine = macdLine.map(() => null)
  const histogram = macdLine.map(() => null)
  for (let j = signalPeriod - 1; j < signalEma.length; j++) {
    const origIdx = start + j
    if (origIdx >= macdLine.length) break
    signalLine[origIdx] = signalEma[j]
    histogram[origIdx] = macdLine[origIdx] != null && signalEma[j] != null ? macdLine[origIdx] - signalEma[j] : null
  }
  return { macdLine, signalLine, histogram }
}

export function getMACDCrossSignal (ohlcv, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(ohlcv) || ohlcv.length < slowPeriod + signalPeriod + 2) {
    return { macd: null, signal: null, histogram: null, crossSignal: null }
  }
  const closes = ohlcv.map(c => c[4])
  const { macdLine, signalLine } = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod)
  const last = ohlcv.length - 1
  const prev = last - 1
  const macdNow = macdLine[last]
  const sigNow = signalLine[last]
  const macdPrev = macdLine[prev]
  const sigPrev = signalLine[prev]
  if (macdNow == null || sigNow == null || macdPrev == null || sigPrev == null) {
    return { macd: macdNow, signal: sigNow, histogram: null, crossSignal: null }
  }
  let crossSignal = null
  if (macdPrev < sigPrev && macdNow > sigNow) crossSignal = 'long'
  if (macdPrev > sigPrev && macdNow < sigNow) crossSignal = 'short'
  return {
    macd: macdNow,
    signal: sigNow,
    histogram: macdNow - sigNow,
    crossSignal
  }
}

// RSI (Wilder) on closing prices
export function calculateRSI (values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) {
    return []
  }
  const rsi = new Array(values.length).fill(null)
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    if (avgLoss === 0) {
      rsi[i] = 100
    } else {
      const rs = avgGain / avgLoss
      rsi[i] = 100 - 100 / (1 + rs)
    }
  }
  return rsi
}

// Bollinger Bands on closing prices
export function calculateBollinger (values, period = 20, k = 2) {
  if (!Array.isArray(values) || values.length < period) {
    return { middle: [], upper: [], lower: [] }
  }
  const n = values.length
  const middle = new Array(n).fill(null)
  const upper = new Array(n).fill(null)
  const lower = new Array(n).fill(null)

  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const v = values[i]
    sum += v
    sumSq += v * v
    if (i >= period) {
      const old = values[i - period]
      sum -= old
      sumSq -= old * old
    }
    if (i >= period - 1) {
      const mean = sum / period
      const variance = sumSq / period - mean * mean
      const std = Math.sqrt(Math.max(variance, 0))
      middle[i] = mean
      upper[i] = mean + k * std
      lower[i] = mean - k * std
    }
  }
  return { middle, upper, lower }
}

// ATR (Average True Range) on OHLCV
export function calculateATR (ohlcv, period = 14) {
  if (!Array.isArray(ohlcv) || ohlcv.length < period + 1) {
    return []
  }
  const n = ohlcv.length
  const tr = new Array(n).fill(null)
  for (let i = 1; i < n; i++) {
    const [, high, low, , , ] = ohlcv[i]
    const prevClose = ohlcv[i - 1][4]
    const range1 = high - low
    const range2 = Math.abs(high - prevClose)
    const range3 = Math.abs(low - prevClose)
    tr[i] = Math.max(range1, range2, range3)
  }
  const atr = new Array(n).fill(null)
  let sumTr = 0
  for (let i = 1; i <= period; i++) {
    sumTr += tr[i]
  }
  let prevAtr = sumTr / period
  atr[period] = prevAtr
  for (let i = period + 1; i < n; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period
    atr[i] = prevAtr
  }
  return atr
}

