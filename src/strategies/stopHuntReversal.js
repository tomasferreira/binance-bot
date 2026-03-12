export const id = 'stop_hunt_reversal'
export const name = 'Stop-Hunt Reversal'
export const description =
  'Fades failed breakouts where price wicks beyond recent highs/lows and then closes back inside the range. Exits via SL/TP.'

const LOOKBACK = 36 // ~9h on 15m for recent range (failed breakout)
const WICK_MULTIPLIER = 1.5 // wick must be > body * this
const MIN_WICK_FRACTION = 0.4 // wick must be at least this fraction of total bar range

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = LOOKBACK + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const i = ohlcv.length - 1
  const [ts, open, high, low, close, volume] = ohlcv[i]

  const window = ohlcv.slice(i - LOOKBACK, i) // exclude current bar
  const priorHigh = Math.max(...window.map(c => c[2]))
  const priorLow = Math.min(...window.map(c => c[3]))

  const range = (high - low) || 0
  const body = Math.abs((close ?? 0) - (open ?? 0))
  const upperWick = high - Math.max(open, close)
  const lowerWick = Math.min(open, close) - low

  const wickIsLarge = (wick) => range > 0 && wick > 0 && wick >= MIN_WICK_FRACTION * range && wick >= WICK_MULTIPLIER * body

  const brokeAbove = high > priorHigh
  const brokeBelow = low < priorLow
  const closeBackBelowHigh = close <= priorHigh
  const closeBackAboveLow = close >= priorLow

  const bigUpperWick = wickIsLarge(upperWick)
  const bigLowerWick = wickIsLarge(lowerWick)

  const bearStopHunt = brokeAbove && closeBackBelowHigh && bigUpperWick
  const bullStopHunt = brokeBelow && closeBackAboveLow && bigLowerWick

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'

  // Optionally lean with the higher timeframe trend
  const allowShort = trend === 'trending' ? dir !== 'bullish' : true
  const allowLong = trend === 'trending' ? dir !== 'bearish' : true

  if (log) {
    log.info(
      `[${id}] ts=${new Date(ts).toISOString()} high=${high.toFixed(2)} low=${low.toFixed(
        2
      )} priorHigh=${priorHigh.toFixed(2)} priorLow=${priorLow.toFixed(2)} ` +
        `bearStopHunt=${bearStopHunt} bullStopHunt=${bullStopHunt}`
    )
  }

  if (state?.openPosition) {
    return {
      action: 'hold',
      detail: {
        ts,
        priorHigh,
        priorLow,
        high,
        low,
        close,
        hasOpenPosition: true
      }
    }
  }

  if (!state?.openPosition && bearStopHunt && allowShort) {
    if (log) log.info(`[${id}] ENTER-SHORT on stop-hunt above range`)
    return {
      action: 'enter-short',
      detail: {
        type: 'stop_hunt',
        direction: 'short',
        ts,
        priorHigh,
        priorLow,
        high,
        low,
        close,
        volume
      }
    }
  }

  if (!state?.openPosition && bullStopHunt && allowLong) {
    if (log) log.info(`[${id}] ENTER-LONG on stop-hunt below range`)
    return {
      action: 'enter-long',
      detail: {
        type: 'stop_hunt',
        direction: 'long',
        ts,
        priorHigh,
        priorLow,
        high,
        low,
        close,
        volume
      }
    }
  }

  return {
    action: 'hold',
    detail: {
      ts,
      priorHigh,
      priorLow,
      high,
      low,
      close,
      volume,
      bearStopHunt,
      bullStopHunt
    }
  }
}

