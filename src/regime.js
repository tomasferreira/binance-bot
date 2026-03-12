import { calculateATR, calculateADX } from './indicators.js'

const ATR_PERIOD = 14
const ADX_PERIOD = 14
const ATR_LOOKBACK = 50
const ADX_SMOOTH = 3

function avgNonNull (arr) {
  let sum = 0
  let count = 0
  for (const v of arr) {
    if (v != null) { sum += v; count++ }
  }
  return count > 0 ? sum / count : null
}

/**
 * Compute regime (volatility, trend, trend direction) from regime OHLCV.
 * @param {Array<[number, number, number, number, number, number]>} regimeOhlcv
 * @returns {{ volatility: string, trend: string, trendDirection: string, volatilityRatio: number|null, adxNow: number|null, plusDiNow: number|null, minusDiNow: number|null } | null}
 */
export function computeRegime (regimeOhlcv) {
  if (!Array.isArray(regimeOhlcv) || regimeOhlcv.length < 30) return null

  const atrArr = calculateATR(regimeOhlcv, ATR_PERIOD)
  const atrNow = atrArr.length ? atrArr[atrArr.length - 1] : null
  const atrAvg = atrArr.length >= ATR_LOOKBACK
    ? avgNonNull(atrArr.slice(-ATR_LOOKBACK))
    : avgNonNull(atrArr)

  let volatility = 'neutral'
  let volatilityRatio = null
  if (atrNow != null && atrAvg != null && atrAvg > 0) {
    volatilityRatio = atrNow / atrAvg
    if (volatilityRatio >= 1.2) volatility = 'high'
    else if (volatilityRatio <= 0.8) volatility = 'low'
  }

  const { adx: adxArr, plusDi: plusDiArr, minusDi: minusDiArr } = calculateADX(regimeOhlcv, ADX_PERIOD)

  // Smooth ADX/DI over last ADX_SMOOTH bars to reduce flicker at thresholds
  const adxNow = avgNonNull(adxArr.slice(-ADX_SMOOTH))
  const plusDiNow = avgNonNull(plusDiArr.slice(-ADX_SMOOTH))
  const minusDiNow = avgNonNull(minusDiArr.slice(-ADX_SMOOTH))

  let trend = 'weak'
  if (adxNow != null) {
    if (adxNow >= 25) trend = 'trending'
    else if (adxNow < 20) trend = 'ranging'
  }

  let trendDirection = 'neutral'
  if (plusDiNow != null && minusDiNow != null) {
    if (plusDiNow > minusDiNow) trendDirection = 'bullish'
    else if (minusDiNow > plusDiNow) trendDirection = 'bearish'
  }

  return {
    volatility,
    trend,
    trendDirection,
    volatilityRatio,
    adxNow,
    plusDiNow,
    minusDiNow
  }
}
