import { calculateEMA, calculateRSI, calculateATR } from '../indicators.js'

export const id = 'short_overbought'
export const name = 'Short Overbought in Downtrend (RSI 14)'
export const description =
  'Shorts when RSI(14) drops back below 70 (exiting overbought) in a downtrend (EMA 50 < 200). Exits when RSI normalizes or trend breaks.'

const RSI_PERIOD = 14
const FAST = 50
const SLOW = 200
const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 3.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(SLOW, RSI_PERIOD) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const rsiArr = calculateRSI(closes, RSI_PERIOD)
  const emaFastArr = calculateEMA(closes, FAST)
  const emaSlowArr = calculateEMA(closes, SLOW)
  const i = closes.length - 1
  const prev = i - 1

  const price = closes[i]
  const rsi = rsiArr[i]
  const rsiPrev = rsiArr[prev]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]

  if ([price, rsi, rsiPrev, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, rsi, emaFast, emaSlow } }
  }

  const trendDown = emaFast < emaSlow
  const rsiExitingOverbought = rsiPrev >= 70 && rsi < 70
  const rsiNormalized = rsi < 50

  const detail = { price, rsi, emaFast, emaSlow, trendDown, rsiExitingOverbought }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} RSI=${rsi.toFixed(
        2
      )} emaFast=${emaFast.toFixed(2)} emaSlow=${emaSlow.toFixed(
        2
      )} trendDown=${trendDown} rsiExitOB=${rsiExitingOverbought}`
    )
  }

  if (state?.openPosition?.side === 'short') {
    const exitCondition = rsiNormalized || !trendDown
    if (exitCondition) {
      if (log) log.info(`[${id}] EXIT-SHORT signal`)
      return { action: 'exit-short', detail: { ...detail, rsiNormalized } }
    }
    return { action: 'hold', detail }
  }

  if (!state?.openPosition && trendDown && rsiExitingOverbought) {
    if (log) log.info(`[${id}] ENTER-SHORT (RSI dropping out of overbought)`)
    return { action: 'enter-short', detail: { ...detail, stopLoss: (atr != null ? price + SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price - TP_ATR_MULT * atr : undefined) } }
  }

  return { action: 'hold', detail }
}

