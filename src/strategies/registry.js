import { logger as defaultLogger } from '../logger.js'
import * as emaCrossover from './emaCrossover.js'
import * as macd from './macd.js'
import * as multiEma from './multiEma.js'
import * as priceVsEma from './priceVsEma.js'
import * as rsiPullback from './rsiPullback.js'
import * as bollingerMeanRevert from './bollingerMeanRevert.js'
import * as multiTfTrend from './multiTfTrend.js'
import * as atrTrend from './atrTrend.js'
import * as shortTrend from './shortTrend.js'
import * as shortBreakdown from './shortBreakdown.js'
import * as shortOverbought from './shortOverbought.js'
import * as shortMacd from './shortMacd.js'
import * as shortRejection from './shortRejection.js'
import * as macdHistogram from './macdHistogram.js'
import * as volumeEmaCrossover from './volumeEmaCrossover.js'
import * as emaFastCrossover from './emaFastCrossover.js'
import * as rsiMacdCombo from './rsiMacdCombo.js'
import * as bollingerSqueeze from './bollingerSqueeze.js'
import * as donchianBreakout from './donchianBreakout.js'
import * as stochasticOversold from './stochasticOversold.js'
import * as atrBreakout from './atrBreakout.js'
import * as rangeBounce from './rangeBounce.js'
import * as impulseFollow from './impulseFollow.js'
import * as stopHuntReversal from './stopHuntReversal.js'
import * as impulsePullback from './impulsePullback.js'
import * as vwapRevert from './vwapRevert.js'
import * as volumeClimaxReversal from './volumeClimaxReversal.js'

const strategies = {
  [emaCrossover.id]: emaCrossover,
  [macd.id]: macd,
  [multiEma.id]: multiEma,
  [priceVsEma.id]: priceVsEma,
  [rsiPullback.id]: rsiPullback,
  [bollingerMeanRevert.id]: bollingerMeanRevert,
  [multiTfTrend.id]: multiTfTrend,
  [atrTrend.id]: atrTrend,
  [shortTrend.id]: shortTrend,
  [shortBreakdown.id]: shortBreakdown,
  [shortOverbought.id]: shortOverbought,
  [shortMacd.id]: shortMacd,
  [shortRejection.id]: shortRejection,
  [macdHistogram.id]: macdHistogram,
  [volumeEmaCrossover.id]: volumeEmaCrossover,
  [emaFastCrossover.id]: emaFastCrossover,
  [rsiMacdCombo.id]: rsiMacdCombo,
  [bollingerSqueeze.id]: bollingerSqueeze,
  [donchianBreakout.id]: donchianBreakout,
  [stochasticOversold.id]: stochasticOversold,
  [atrBreakout.id]: atrBreakout,
  [rangeBounce.id]: rangeBounce,
  [impulseFollow.id]: impulseFollow,
  [impulsePullback.id]: impulsePullback,
  [stopHuntReversal.id]: stopHuntReversal,
  [vwapRevert.id]: vwapRevert,
  [volumeClimaxReversal.id]: volumeClimaxReversal
}

/** Regime filter: (regime) => true = allow entry. Omitted strategy = no filter.
 *  trend: 'trending' (ADX>=25, hysteresis exit 22), 'weak' (20-25), 'ranging' (<20, hysteresis exit 23)
 *  trendDirection: 'bullish', 'bearish', 'neutral' (from smoothed DI+/DI- with min gap 5)
 *  Direction is 'neutral' in ranging markets (DI crossovers are noise without trend).
 *  High volatility + weak/ranging = choppy whipsaw zone, blocked for all strategy types.
 *  Trend-followers: confirmed trend OR weak trend with correct direction (not in high vol).
 *  Mean-reversion: ranging or weak or low vol (not in high vol — swings are too wide).
 *  Reversal: non-trending and not high vol. */
const notTrending = (r) => r.trend !== 'trending' && r.volatility !== 'high'
const bullish = (r) => (r.trend === 'trending' || (r.trend === 'weak' && r.volatility !== 'high')) && r.trendDirection === 'bullish'
const bearish = (r) => (r.trend === 'trending' || (r.trend === 'weak' && r.volatility !== 'high')) && r.trendDirection === 'bearish'
const directional = (r) => (r.trend === 'trending' || (r.trend === 'weak' && r.volatility !== 'high')) && r.trendDirection !== 'neutral'
const meanRevert = (r) => (r.trend === 'ranging' || r.trend === 'weak' || r.volatility === 'low') && r.volatility !== 'high'

const REGIME_FILTERS = {
  [emaCrossover.id]: bullish,
  [macd.id]: bullish,
  [multiEma.id]: bullish,
  [priceVsEma.id]: bullish,
  [rsiPullback.id]: bullish,
  [multiTfTrend.id]: bullish,
  [atrTrend.id]: bullish,
  [macdHistogram.id]: directional,
  [volumeEmaCrossover.id]: bullish,
  [emaFastCrossover.id]: bullish,
  [rsiMacdCombo.id]: bullish,
  [shortTrend.id]: bearish,
  [shortBreakdown.id]: bearish,
  [shortMacd.id]: bearish,
  [shortOverbought.id]: (r) => r.trendDirection === 'bearish',
  [shortRejection.id]: (r) => r.trendDirection !== 'bullish',
  [bollingerMeanRevert.id]: meanRevert,
  [rangeBounce.id]: meanRevert,
  [stochasticOversold.id]: (r) => r.trend !== 'trending' || r.trendDirection === 'bullish',
  [bollingerSqueeze.id]: bullish,
  [donchianBreakout.id]: bullish,
  [atrBreakout.id]: bullish,
  [impulseFollow.id]: directional,
  [impulsePullback.id]: directional,
  [stopHuntReversal.id]: notTrending,
  [vwapRevert.id]: notTrending,
  [volumeClimaxReversal.id]: notTrending
}

// Recommended timeframe per strategy (candle size for signal evaluation).
// All signal metrics (EMA periods, RSI/MACD/BB periods, lookbacks) are in bars of this TF.
// Time-based lookbacks (e.g. "1 day" in vwap_revert) use context.timeframe to scale.
// 1h: trend/mean-revert (EMA 50/200, MACD 12/26/9, BB 20, RSI 14, ATR 14, etc.).
// 15m: multi-EMA 9/21/50, price vs EMA 20/50, Donchian 20, Stochastic 14/3, stop-hunt 50 bars.
// 5m: ATR breakout 20, EMA cross 9/21, impulse 20 bars, VWAP 24h bars, volume climax 20/8.
const STRATEGY_TIMEFRAMES = {
  [emaCrossover.id]: '1h',
  [macd.id]: '1h',
  [macdHistogram.id]: '1h',
  [multiTfTrend.id]: '1h',
  [rsiPullback.id]: '1h',
  [rsiMacdCombo.id]: '1h',
  [bollingerMeanRevert.id]: '1h',
  [bollingerSqueeze.id]: '1h',
  [atrTrend.id]: '1h',
  [volumeEmaCrossover.id]: '1h',
  [shortTrend.id]: '1h',
  [shortBreakdown.id]: '1h',
  [shortOverbought.id]: '1h',
  [shortMacd.id]: '1h',
  [shortRejection.id]: '1h',
  [rangeBounce.id]: '1h',
  [multiEma.id]: '15m',
  [priceVsEma.id]: '15m',
  [donchianBreakout.id]: '15m',
  [stochasticOversold.id]: '15m',
  [stopHuntReversal.id]: '15m',
  [atrBreakout.id]: '5m',
  [emaFastCrossover.id]: '5m',
  [impulseFollow.id]: '5m',
  [impulsePullback.id]: '5m',
  [vwapRevert.id]: '5m',
  [volumeClimaxReversal.id]: '5m'
}

export const STRATEGY_IDS = Object.keys(strategies)

// Direction metadata for UI / analytics: 'long' | 'short' | 'both'
const STRATEGY_DIRECTIONS = {
  [emaCrossover.id]: 'long',
  [macd.id]: 'long',
  [multiEma.id]: 'long',
  [priceVsEma.id]: 'long',
  [rsiPullback.id]: 'long',
  [bollingerMeanRevert.id]: 'long',
  [multiTfTrend.id]: 'long',
  [atrTrend.id]: 'long',
  [shortTrend.id]: 'short',
  [shortBreakdown.id]: 'short',
  [shortOverbought.id]: 'short',
  [shortMacd.id]: 'short',
  [shortRejection.id]: 'short',
  [macdHistogram.id]: 'both',
  [volumeEmaCrossover.id]: 'long',
  [emaFastCrossover.id]: 'long',
  [rsiMacdCombo.id]: 'long',
  [bollingerSqueeze.id]: 'long',
  [donchianBreakout.id]: 'long',
  [stochasticOversold.id]: 'long',
  [atrBreakout.id]: 'long',
  [rangeBounce.id]: 'long',
  [impulseFollow.id]: 'both',
  [impulsePullback.id]: 'both',
  [stopHuntReversal.id]: 'both',
  [vwapRevert.id]: 'both',
  [volumeClimaxReversal.id]: 'both'
}

export function getStrategy (id) {
  return strategies[id] ?? null
}

export function getStrategyDirection (id) {
  if (!id) return 'long'
  return STRATEGY_DIRECTIONS[id] || (id.startsWith('short_') ? 'short' : 'long')
}

/** Timeframe (candle size) for a strategy's signal evaluation. Falls back to defaultTf if not in STRATEGY_TIMEFRAMES. */
export function getStrategyTimeframe (id, defaultTf = '15m') {
  return STRATEGY_TIMEFRAMES[id] ?? defaultTf
}

/** True if this strategy is allowed to enter in the current regime (for dashboard highlighting). */
export function isRegimeActive (id, regime, regimeFilterEnabled) {
  if (!regimeFilterEnabled) return true
  const filter = REGIME_FILTERS[id]
  if (!filter) return true
  if (!regime) return false
  return !!filter(regime)
}

export function evaluateStrategy (id, ohlcv, state, context = {}) {
  const log = (context && context.logger) || defaultLogger
  const s = getStrategy(id)
  if (!s?.evaluate) return { action: 'hold', detail: {} }
  const lastClose = Array.isArray(ohlcv) && ohlcv.length ? ohlcv[ohlcv.length - 1][4] : null
  log.debug(`evaluateStrategy: ${id} start`, {
    lastClose,
    hasOpenPosition: !!state?.openPosition,
    side: state?.openPosition?.side || null
  })
  const strategyContext = { ...context, logger: log }
  const decision = s.evaluate(ohlcv, state, strategyContext)
  const action = decision?.action || 'hold'
  // Highlight whenever a strategy **requests** an entry/exit, regardless of
  // whether auto-trading, regime filter, or other constraints will actually
  // execute the trade.
  if (
    action === 'enter-long' ||
    action === 'enter-short' ||
    action === 'exit-long' ||
    action === 'exit-short'
  ) {
    log.warn(`strategy-decision: ${id} requested ${action}`, {
      hasOpenPosition: !!state?.openPosition,
      side: state?.openPosition?.side || null,
      detail: decision?.detail || {},
      regime: context?.regime || null,
      regimeFilterEnabled: context?.regimeFilterEnabled !== false
    })
  }
  const regime = context?.regime
  const regimeFilterEnabled = context?.regimeFilterEnabled !== false
  const filter = REGIME_FILTERS[id]
  if (
    regimeFilterEnabled &&
    filter &&
    (action === 'enter-long' || action === 'enter-short') &&
    (!regime || !filter(regime))
  ) {
    log.debug(`evaluateStrategy: ${id} regime filter blocked entry`, { regime, action, reason: regime ? 'filter rejected' : 'regime unavailable' })
    return {
      action: 'hold',
      detail: { ...(decision?.detail || {}), regimeSkipped: true }
    }
  }
  log.debug(`evaluateStrategy: ${id} result`, {
    action: decision?.action,
    detail: decision?.detail
  })
  return decision
}
