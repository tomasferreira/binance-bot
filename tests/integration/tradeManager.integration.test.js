import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock exchange to avoid real network calls
const orders = []

vi.mock('../../src/exchange.js', () => {
  const fakeExchange = {
    async fetchBalance () {
      return { total: { USDT: 1000 }, free: { USDT: 1000 }, used: { USDT: 0 } }
    },
    async createMarketBuyOrder (symbol, amount) {
      const order = { id: 'buy-' + (orders.length + 1), status: 'closed', symbol, amount }
      orders.push(order)
      return order
    },
    async createMarketSellOrder (symbol, amount) {
      const order = { id: 'sell-' + (orders.length + 1), status: 'closed', symbol, amount }
      orders.push(order)
      return order
    }
  }
  return {
    getExchange: () => fakeExchange
  }
})

import { openLongPosition, closePositionNow } from '../../src/tradeManager.js'

describe('tradeManager integration (open & close)', () => {
  beforeEach(() => {
    orders.length = 0
  })

  it('opens and closes a long position, updating PnL and stats', async () => {
    const initialState = {
      openPosition: null,
      realizedPnl: 0,
      wins: 0,
      losses: 0,
      totalWinPnl: 0,
      totalLossPnl: 0,
      positionsOpened: 0,
      closedTrades: 0,
      totalTradeDurationMs: 0,
      closedTradesHistory: []
    }

    const entryPrice = 100
    const strategyId = 'ema_crossover'

    const afterOpen = await openLongPosition({ ...initialState }, entryPrice, strategyId, null, 1000)
    expect(afterOpen.openPosition).toBeTruthy()
    expect(afterOpen.openPosition.side).toBe('long')
    expect(afterOpen.positionsOpened).toBe(1)
    expect(orders.length).toBe(1)

    const exitPrice = 105
    // Pass null as strategyId to avoid disk reload and duplicate-close guard in tests
    const afterClose = await closePositionNow(afterOpen, exitPrice, null, 'Test close', { reason: 'test' })
    expect(afterClose.openPosition).toBeNull()
    expect(afterClose.realizedPnl).toBeGreaterThan(0)
    expect(afterClose.wins).toBe(1)
    expect(afterClose.totalWinPnl).toBeGreaterThan(0)
    expect(afterClose.closedTrades).toBe(1)
    expect(afterClose.closedTradesHistory.length).toBe(1)
  })
})

