import * as emaCrossover from './emaCrossover.js'
import * as macd from './macd.js'
import * as multiEma from './multiEma.js'
import * as priceVsEma from './priceVsEma.js'
import * as rsiPullback from './rsiPullback.js'
import * as bollingerMeanRevert from './bollingerMeanRevert.js'
import * as multiTfTrend from './multiTfTrend.js'
import * as atrTrend from './atrTrend.js'
import * as manual from './manual.js'
import * as shortTrend from './shortTrend.js'
import * as shortBreakdown from './shortBreakdown.js'
import * as shortOverbought from './shortOverbought.js'
import * as shortMacd from './shortMacd.js'
import * as shortRejection from './shortRejection.js'

const strategies = {
  [emaCrossover.id]: emaCrossover,
  [macd.id]: macd,
  [multiEma.id]: multiEma,
  [priceVsEma.id]: priceVsEma,
  [rsiPullback.id]: rsiPullback,
  [bollingerMeanRevert.id]: bollingerMeanRevert,
  [multiTfTrend.id]: multiTfTrend,
  [atrTrend.id]: atrTrend,
  [manual.id]: manual,
  [shortTrend.id]: shortTrend,
  [shortBreakdown.id]: shortBreakdown,
  [shortOverbought.id]: shortOverbought,
  [shortMacd.id]: shortMacd,
  [shortRejection.id]: shortRejection
}

export const STRATEGY_IDS = Object.keys(strategies)

export function getStrategy (id) {
  return strategies[id] ?? null
}

export function evaluateStrategy (id, ohlcv, state) {
  const s = getStrategy(id)
  if (!s?.evaluate) return { action: 'hold', detail: {} }
  return s.evaluate(ohlcv, state)
}
