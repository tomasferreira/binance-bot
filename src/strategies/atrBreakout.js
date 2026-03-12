import { calculateATR, calculateEMA, averageVolume } from '../indicators.js'

export const id = 'atr_breakout'
export const name = 'ATR Breakout (Long)'
export const description =
  'Long when close breaks above the N-period high (two-bar confirmation) and ATR is rising. Exits when price closes below EMA 20; otherwise SL/TP.'

const LOOKBACK = 24 // 2h on 5m for N-period high
const ATR_PERIOD = 14
const ATR_RISE_LOOKBACK = 5
const TREND_EMA = 20
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2.5
const VOL_MULT = 1.2
const VOL_PERIOD = 20

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(LOOKBACK, ATR_PERIOD, TREND_EMA) + ATR_RISE_LOOKBACK + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const i = ohlcv.length - 1
  const prev = i - 1
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, TREND_EMA)
  const ema20 = emaArr[i]
  const highPrev = Math.max(...ohlcv.slice(prev - LOOKBACK, prev).map(c => c[2]))
  const price = ohlcv[i][4]
  const prevClose = ohlcv[prev][4]
  const atrArr = calculateATR(ohlcv, ATR_PERIOD)
  const atrNow = atrArr[i]
  const atrPast = atrArr[i - ATR_RISE_LOOKBACK]

  if (atrNow == null || atrPast == null) {
    return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
  }

  const atrRising = atrNow > atrPast
  const bothClosesAbove = prevClose > highPrev && price > highPrev
  const vol = ohlcv[i][5] ?? 0
  const avgVol = averageVolume(ohlcv.slice(0, i), VOL_PERIOD)
  const volOk = avgVol != null && avgVol > 0 && vol > VOL_MULT * avgVol

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} prevClose=${prevClose.toFixed(
        2
      )} high${LOOKBACK}=${highPrev.toFixed(2)} bothAbove=${bothClosesAbove} atrRising=${atrRising} volOk=${volOk}`
    )
  }

  if (!state?.openPosition && bothClosesAbove && atrRising && volOk) {
    if (log) log.info(`[${id}] LONG signal (two-bar close above + ATR rising)`)
    return { action: 'enter-long', detail: { price, highPrev, prevClose, atr: atrNow, stopLoss: (atrNow != null ? price - SL_ATR_MULT * atrNow : undefined), takeProfit: (atrNow != null ? price + TP_ATR_MULT * atrNow : undefined) } }
  }
  if (state?.openPosition && ema20 != null && price < ema20) {
    if (log) log.info(`[${id}] EXIT signal (price below EMA 20)`)
    return { action: 'exit-long', detail: { price, highPrev, atr: atrNow, ema20 } }
  }

  return { action: 'hold', detail: { price, highPrev, atr: atrNow } }
}
