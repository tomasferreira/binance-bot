import { config } from './config.js'
import { getExchange } from './exchange.js'
import { calculatePositionSize } from './risk.js'
import { logger } from './logger.js'
import { recordOrderStrategy } from './orderStrategy.js'
import { loadState } from './stateMulti.js'

const { symbol, feeRatePct } = config.trading
const feeRate = typeof feeRatePct === 'number' && feeRatePct >= 0 ? feeRatePct : 0

export async function syncBalanceQuote () {
  const exchange = getExchange()
  logger.debug('exchange.fetchBalance request', { symbol })
  const balance = await exchange.fetchBalance()
  logger.debug('exchange.fetchBalance response', {
    total: balance.total,
    free: balance.free,
    used: balance.used
  })
  const quoteCurrency = symbol.split('/')[1]
  const quoteInfo = balance.total?.[quoteCurrency] ?? balance.free?.[quoteCurrency]
  const quoteBalance = Number(quoteInfo || 0)
  logger.debug('syncBalanceQuote result', { quoteCurrency, quoteBalance })
  return quoteBalance
}

export async function openLongPosition (state, marketPrice, strategyId = null, entryDetail = null, budgetQuote = null) {
  const exchange = getExchange()

  const quoteBalance = (budgetQuote != null && budgetQuote > 0) ? budgetQuote : await syncBalanceQuote()
  if (!quoteBalance) {
    logger.warn('No quote balance available; cannot open position')
    return state
  }

  const {
    riskPerTrade,
    stopLossPct,
    takeProfitPct
  } = state.runtimeConfig || {}

  const effectiveRiskPerTrade =
    typeof riskPerTrade === 'number' && riskPerTrade > 0
      ? riskPerTrade
      : config.trading.riskPerTrade
  const effectiveStopLossPct =
    typeof stopLossPct === 'number' && stopLossPct > 0
      ? stopLossPct
      : config.trading.stopLossPct
  const effectiveTakeProfitPct =
    typeof takeProfitPct === 'number' && takeProfitPct > 0
      ? takeProfitPct
      : config.trading.takeProfitPct

  // SL/TP adjusted for round-trip fee so net loss/profit matches intended %
  const stopLossPrice = marketPrice * (1 - effectiveStopLossPct + feeRate) / (1 + feeRate)
  const takeProfitPrice = marketPrice * (1 + effectiveTakeProfitPct + 2 * feeRate)

  logger.debug('openLongPosition: computed risk config', {
    strategyId,
    marketPrice,
    budgetQuote,
    quoteBalance,
    effectiveRiskPerTrade,
    effectiveStopLossPct,
    effectiveTakeProfitPct,
    stopLossPrice,
    takeProfitPrice
  })

  const amount = calculatePositionSize({
    balanceQuote: quoteBalance,
    entryPrice: marketPrice,
    stopLossPrice,
    riskPerTrade: effectiveRiskPerTrade,
    feeRatePct: feeRate
  })

  if (amount <= 0) {
    logger.warn('Calculated zero or negative position size; skipping trade')
    return state
  }

  logger.info(
    `Opening LONG position on ${symbol} at ${marketPrice}, amount ${amount}, SL ${stopLossPrice}, TP ${takeProfitPrice}`
  )
  logger.debug('exchange.createMarketBuyOrder request', { symbol, amount })
  const order = await exchange.createMarketBuyOrder(symbol, amount)
  logger.debug('exchange.createMarketBuyOrder response', { order })
  logger.info(`Market BUY order placed: id=${order.id}, status=${order.status}`)
  if (strategyId) recordOrderStrategy(order.id, strategyId, strategyId === 'manual' ? 'Manual' : 'Entry', entryDetail ?? null)

  const newPosition = {
    side: 'long',
    symbol,
    entryPrice: marketPrice,
    amount,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    openedAt: new Date().toISOString(),
    lastPrice: marketPrice
  }

  const positionsOpened = (state.positionsOpened ?? 0) + 1
  return { ...state, openPosition: newPosition, lastSignal: 'long', positionsOpened }
}

export async function openShortPosition (state, marketPrice, strategyId = null, entryDetail = null, budgetQuote = null) {
  const exchange = getExchange()

  const quoteBalance = (budgetQuote != null && budgetQuote > 0) ? budgetQuote : await syncBalanceQuote()
  if (!quoteBalance) {
    logger.warn('No quote balance available; cannot open short position')
    return state
  }

  const {
    riskPerTrade,
    stopLossPct,
    takeProfitPct
  } = state.runtimeConfig || {}

  const effectiveRiskPerTrade =
    typeof riskPerTrade === 'number' && riskPerTrade > 0
      ? riskPerTrade
      : config.trading.riskPerTrade
  const effectiveStopLossPct =
    typeof stopLossPct === 'number' && stopLossPct > 0
      ? stopLossPct
      : config.trading.stopLossPct
  const effectiveTakeProfitPct =
    typeof takeProfitPct === 'number' && takeProfitPct > 0
      ? takeProfitPct
      : config.trading.takeProfitPct

  // For shorts, SL is above entry, TP is below entry.
  // We keep fee-aware sizing via calculatePositionSize; price levels are simple percentages.
  const stopLossPrice = marketPrice * (1 + effectiveStopLossPct)
  const takeProfitPrice = marketPrice * (1 - effectiveTakeProfitPct)

  logger.debug('openShortPosition: computed risk config', {
    strategyId,
    marketPrice,
    budgetQuote,
    quoteBalance,
    effectiveRiskPerTrade,
    effectiveStopLossPct,
    effectiveTakeProfitPct,
    stopLossPrice,
    takeProfitPrice
  })

  const amount = calculatePositionSize({
    balanceQuote: quoteBalance,
    entryPrice: marketPrice,
    stopLossPrice,
    riskPerTrade: effectiveRiskPerTrade,
    feeRatePct: feeRate
  })

  if (amount <= 0) {
    logger.warn('Calculated zero or negative position size for short; skipping trade')
    return state
  }

  logger.info(
    `Opening SHORT position on ${symbol} at ${marketPrice}, amount ${amount}, SL ${stopLossPrice}, TP ${takeProfitPrice}`
  )

  logger.debug('exchange.createMarketSellOrder request (short entry)', { symbol, amount })
  const order = await exchange.createMarketSellOrder(symbol, amount)
  logger.debug('exchange.createMarketSellOrder response (short entry)', { order })
  logger.info(`Market SELL (short) order placed: id=${order.id}, status=${order.status}`)
  if (strategyId) recordOrderStrategy(order.id, strategyId, strategyId === 'manual' ? 'Manual' : 'Short entry', entryDetail ?? null)

  const newPosition = {
    side: 'short',
    symbol,
    entryPrice: marketPrice,
    amount,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    openedAt: new Date().toISOString(),
    lastPrice: marketPrice
  }

  const positionsOpened = (state.positionsOpened ?? 0) + 1
  return { ...state, openPosition: newPosition, lastSignal: 'short', positionsOpened }
}

// Immediately closes any open position at market, ignoring SL/TP levels.
export async function closePositionNow (state, marketPrice, strategyId = null, reason = 'Manual close', exitDetail = null) {
  const position = state.openPosition
  if (!position) return state

  const { side, amount } = position
  if (!amount || amount <= 0) {
    return state
  }

  // Avoid duplicate close: re-read state from disk; if already closed, skip order
  if (strategyId) {
    const fresh = loadState(strategyId)
    if (!fresh.openPosition) {
      logger.warn(`[${strategyId}] Skipping close - position already closed (state on disk)`)
      return fresh
    }
  }

  const exchange = getExchange()
  const orderSide = side === 'short' ? 'buy' : 'sell'

  logger.info(
    `Manual CLOSE ${side.toUpperCase()} position at marketPrice=${marketPrice}, entry=${position.entryPrice}, amount=${amount}`
  )

  if (orderSide === 'sell') {
    logger.debug('exchange.createMarketSellOrder request (close)', { symbol, amount })
  } else {
    logger.debug('exchange.createMarketBuyOrder request (close)', { symbol, amount })
  }
  const order = orderSide === 'sell'
    ? await exchange.createMarketSellOrder(symbol, amount)
    : await exchange.createMarketBuyOrder(symbol, amount)
  logger.debug('exchange market order response (close)', { orderSide, order })
  logger.info(`Market ${orderSide.toUpperCase()} order placed: id=${order.id}, status=${order.status}`)
  if (strategyId) recordOrderStrategy(order.id, strategyId, reason, exitDetail ?? null)

  const pnl = side === 'short'
    ? (position.entryPrice - marketPrice) * amount
    : (marketPrice - position.entryPrice) * amount
  const realizedPnl = (state.realizedPnl ?? 0) + pnl
  logger.info(`Closed position PnL: ${pnl.toFixed(2)} USDT, realized total: ${realizedPnl.toFixed(2)}`)
  let wins = state.wins ?? 0
  let losses = state.losses ?? 0
  let totalWinPnl = state.totalWinPnl ?? 0
  let totalLossPnl = state.totalLossPnl ?? 0
  if (pnl > 0) {
    wins++
    totalWinPnl += pnl
  } else if (pnl < 0) {
    losses++
    totalLossPnl += pnl
  }

  const openedAtMs = position.openedAt ? Date.parse(position.openedAt) : null
  const closedAtMs = Date.now()
  let closedTrades = state.closedTrades ?? 0
  let totalTradeDurationMs = state.totalTradeDurationMs ?? 0
  let firstTradeAt = state.firstTradeAt ?? (position.openedAt || null)
  if (openedAtMs != null && Number.isFinite(openedAtMs)) {
    const dur = Math.max(0, closedAtMs - openedAtMs)
    totalTradeDurationMs += dur
    closedTrades += 1
  }

  let peakEquity = state.peakEquity ?? 0
  let maxDrawdown = state.maxDrawdown ?? 0
  const equity = realizedPnl
  if (equity > peakEquity) {
    peakEquity = equity
  } else {
    const dd = equity - peakEquity
    if (dd < maxDrawdown) maxDrawdown = dd
  }

  const closedTradesHistory = Array.isArray(state.closedTradesHistory) ? state.closedTradesHistory : []
  closedTradesHistory.push({ timestamp: new Date().toISOString(), pnl })
  const MAX_HISTORY = 500
  const trimmed = closedTradesHistory.length > MAX_HISTORY ? closedTradesHistory.slice(-MAX_HISTORY) : closedTradesHistory

  return {
    ...state,
    openPosition: null,
    realizedPnl,
    wins,
    losses,
    totalWinPnl,
    totalLossPnl,
    closedTrades,
    totalTradeDurationMs,
    firstTradeAt,
    peakEquity,
    maxDrawdown,
    closedTradesHistory: trimmed
  }
}

export async function maybeClosePosition (state, marketPrice, strategyId = null) {
  const position = state.openPosition
  if (!position) return state

  const { side, stopLoss, takeProfit } = position

  let shouldStop = false
  let shouldTakeProfit = false

  if (side === 'long') {
    shouldStop = stopLoss != null && marketPrice <= stopLoss
    shouldTakeProfit = takeProfit != null && marketPrice >= takeProfit
  } else if (side === 'short') {
    shouldStop = stopLoss != null && marketPrice >= stopLoss
    shouldTakeProfit = takeProfit != null && marketPrice <= takeProfit
  }

  if (!shouldStop && !shouldTakeProfit) {
    return { ...state, openPosition: { ...position, lastPrice: marketPrice } }
  }

  const closeReason = shouldStop ? 'Stop loss' : 'Take profit'
  const slTpDetail = {
    marketPrice,
    entryPrice: position.entryPrice,
    trigger: shouldStop ? 'stop_loss' : 'take_profit'
  }

  return closePositionNow(state, marketPrice, strategyId, closeReason, slTpDetail)
}

