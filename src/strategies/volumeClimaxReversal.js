import { logger } from '../logger.js'

export const id = 'volume_climax_reversal'
export const name = 'Volume Climax Reversal'
export const description =
  'Fades exhaustion: after a directional move, enters opposite on a volume-climax bar (volume spike + dominant wick, close at wrong end). Exits via SL/TP.'

// Volume climax
const VOL_LOOKBACK = 20
const VOL_CLIMAX_MULT = 2 // current bar volume >= this × average

// Prior move
const MOVE_LOOKBACK = 8
const MIN_MOVE_BARS = 3 // at least this many bars in the same direction

// Climax bar shape
const WICK_VS_BODY = 1.5 // dominant wick: wick >= body * this
const CLOSE_OUTER_THIRD = 1 / 3 // close in outer 1/3 of range (bottom for long, top for short)

export function evaluate (ohlcv, state, context = {}) {
  const minLen = Math.max(VOL_LOOKBACK, MOVE_LOOKBACK) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const i = ohlcv.length - 1
  const [ts, open, high, low, close, volume] = ohlcv[i]
  const range = (high - low) || 0
  const body = Math.abs((close ?? 0) - (open ?? 0))
  const upperWick = high - Math.max(open, close)
  const lowerWick = Math.min(open, close) - low
  const vol = volume ?? 0

  const volSlice = ohlcv.slice(i - VOL_LOOKBACK, i).map(c => c[5] ?? 0)
  const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0
  const isClimaxVol = avgVol > 0 && vol >= VOL_CLIMAX_MULT * avgVol

  const prevCloses = ohlcv.slice(i - MOVE_LOOKBACK, i).map(c => c[4])
  const closeThen = prevCloses[0]
  const closeNow = close
  let downBars = 0
  let upBars = 0
  for (let j = 1; j < prevCloses.length; j++) {
    if (prevCloses[j] < prevCloses[j - 1]) downBars++
    else if (prevCloses[j] > prevCloses[j - 1]) upBars++
  }
  const hadDownMove = closeThen != null && closeNow != null && closeNow < closeThen && downBars >= MIN_MOVE_BARS
  const hadUpMove = closeThen != null && closeNow != null && closeNow > closeThen && upBars >= MIN_MOVE_BARS

  const closePosInRange = range > 0 ? (close - low) / range : 0.5
  const dominantLowerWick = body > 0 && lowerWick >= WICK_VS_BODY * body && range > 0 && closePosInRange <= CLOSE_OUTER_THIRD
  const dominantUpperWick = body > 0 && upperWick >= WICK_VS_BODY * body && range > 0 && (1 - closePosInRange) <= CLOSE_OUTER_THIRD

  const bullishClimax = isClimaxVol && hadDownMove && dominantLowerWick
  const bearishClimax = isClimaxVol && hadUpMove && dominantUpperWick

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'
  const allowLong = trend === 'trending' ? dir !== 'bearish' : true
  const allowShort = trend === 'trending' ? dir !== 'bullish' : true

  logger.info(
    `[${id}] ts=${new Date(ts).toISOString()} vol=${vol.toFixed(0)} avgVol=${avgVol.toFixed(0)} climaxVol=${isClimaxVol} ` +
      `hadDown=${hadDownMove} hadUp=${hadUpMove} bullClimax=${bullishClimax} bearClimax=${bearishClimax}`
  )

  if (state?.openPosition) {
    return {
      action: 'hold',
      detail: { ts, vol, avgVol, hasOpenPosition: true }
    }
  }

  if (!state?.openPosition && bullishClimax && allowLong) {
    logger.info(`[${id}] ENTER-LONG (volume climax after down move)`)
    return {
      action: 'enter-long',
      detail: {
        type: 'volume_climax',
        direction: 'long',
        ts,
        vol,
        avgVol,
        closePosInRange,
        lowerWick,
        body
      }
    }
  }

  if (!state?.openPosition && bearishClimax && allowShort) {
    logger.info(`[${id}] ENTER-SHORT (volume climax after up move)`)
    return {
      action: 'enter-short',
      detail: {
        type: 'volume_climax',
        direction: 'short',
        ts,
        vol,
        avgVol,
        closePosInRange,
        upperWick,
        body
      }
    }
  }

  return {
    action: 'hold',
    detail: { ts, vol, avgVol, bullishClimax, bearishClimax }
  }
}
