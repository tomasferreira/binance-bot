import { spawn } from 'child_process'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { logger } from './logger.js'
import { getTradingExchange } from './exchange.js'
import { getMarketDataSource, setMarketDataSource } from './marketDataSource.js'
import { loadState, saveState, resetPnlState } from './stateMulti.js'
import { loadRunner, setRunning, setRegimeFilterEnabled, setAllRunning } from './runner.js'
import { STRATEGY_IDS, getStrategy, getStrategyDirection, getStrategyTimeframe, isRegimeActive } from './strategies/registry.js'
import { getOrderStrategyMap } from './orderStrategy.js'
import { openLongPosition, openShortPosition, closePositionNow } from './tradeManager.js'
import { getEMACrossSignal, calculateEMA, calculateMACD, calculateRSI, calculateBollinger } from './indicators.js'
import { computeRegime } from './regime.js'
import { getEffectiveTradingConfig } from './runtimeConfig.js'
import { buildStatusPayload } from './status.js'
import {
  getCurrentBacktest,
  setCurrentBacktest,
  getLastTickAt,
  getLastDecisionByStrategy,
  fetchMarketData,
  fetchRegimeData,
  getStrategyBudget,
  pollIntervalMs,
  symbol,
  timeframe
} from './bot.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const apiPort = config.http.apiPort
const apiDebug = process.env.API_DEBUG === 'true'

export function createApp () {
  const app = express()
  app.use(express.json())

  // Inbound API debug logging: request + response (body + headers) when LOG_LEVEL=DEBUG
  app.use((req, res, next) => {
    if (!apiDebug) return next()
      logger.debug('HTTP inbound', {
      method: req.method,
      url: req.originalUrl || req.url,
      headers: req.headers,
      body: req.body
    })

    const origJson = res.json.bind(res)
    const origSend = res.send.bind(res)

    res.json = (body) => {
      logger.debug('HTTP outbound', {
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        body
      })
      return origJson(body)
    }

    res.send = (body) => {
      logger.debug('HTTP outbound', {
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        body: typeof body === 'string' ? body.slice(0, 2000) : body
      })
      return origSend(body)
    }

    next()
  })

  // Status endpoint used by the dashboard
  app.get('/api/status', async (req, res) => {
    try {
      if (apiDebug) logger.debug('HTTP GET /api/status')
      const runner = loadRunner()
      const exchange = getTradingExchange()
      if (apiDebug) logger.debug('exchange.fetchBalance request (/api/status)', { symbol })
      const balance = await exchange.fetchBalance()
      if (apiDebug) logger.debug('exchange.fetchBalance response (/api/status)', {
        total: balance.total,
        free: balance.free,
        used: balance.used
      })

      const ohlcv = await fetchMarketData(250)
      const last = ohlcv[ohlcv.length - 1]
      const lastPrice = last?.[4] ?? null
      const { fast: ema50, slow: ema200 } = getEMACrossSignal(ohlcv)
      const closes = ohlcv.map(c => c[4])
      const ema9Arr = calculateEMA(closes, 9)
      const ema20Arr = calculateEMA(closes, 20)
      const ema21Arr = calculateEMA(closes, 21)
      const { macdLine, signalLine } = calculateMACD(closes, 12, 26, 9)
      const lastIdx = closes.length - 1
      const ema9 = ema9Arr[lastIdx] ?? null
      const ema20 = ema20Arr[lastIdx] ?? null
      const ema21 = ema21Arr[lastIdx] ?? null
      const macd = macdLine[lastIdx] ?? null
      const macdSignal = signalLine[lastIdx] ?? null

      const lookback = Math.min(20, ohlcv.length)
      let volumeLast = null
      let volumeAvg20 = null
      let recentHigh20 = null
      let recentLow20 = null
      if (ohlcv.length >= 1) {
        volumeLast = ohlcv[ohlcv.length - 1][5] ?? null
        if (lookback >= 1) {
          const volSlice = ohlcv.slice(-lookback).map(c => c[5] ?? 0)
          volumeAvg20 = volSlice.reduce((a, b) => a + b, 0) / volSlice.length
          recentHigh20 = Math.max(...ohlcv.slice(-lookback).map(c => c[2] ?? 0))
          recentLow20 = Math.min(...ohlcv.slice(-lookback).map(c => c[3] ?? Infinity))
        }
      }

      const regimeTf = config.trading.regimeTimeframe || '1h'
      const regimeCandles = Number.isFinite(config.trading.regimeCandles) ? config.trading.regimeCandles : 200
      let regime = { volatility: 'neutral', trend: 'weak', trendDirection: 'neutral' }
      let volatilityRatio = null
      let adxNow = null
      let plusDiNow = null
      let minusDiNow = null
      try {
        const regimeOhlcv = await fetchRegimeData()
        const computed = computeRegime(regimeOhlcv)
        if (computed) {
          regime = { volatility: computed.volatility, trend: computed.trend, trendDirection: computed.trendDirection }
          volatilityRatio = computed.volatilityRatio ?? null
          adxNow = computed.adxNow ?? null
          plusDiNow = computed.plusDiNow ?? null
          minusDiNow = computed.minusDiNow ?? null
        }
      } catch (err) {
        logger.warn('Regime fetch or calculation failed', { err: err.message })
      }

      if (apiDebug) logger.debug('exchange.fetchOpenOrders request (/api/status)', { symbol })
      const openOrders = await exchange.fetchOpenOrders(symbol)
      if (apiDebug) logger.debug('exchange.fetchOpenOrders response (/api/status)', { count: openOrders.length })
      const payload = buildStatusPayload({
        runner,
        lastDecisionByStrategy: getLastDecisionByStrategy(),
        loadState,
        getStrategy,
        getStrategyDirection,
        getStrategyTimeframe,
        STRATEGY_IDS,
        isRegimeActive,
        config,
        getStrategyBudget,
        getEffectiveTradingConfig,
        lastTickAt: getLastTickAt(),
        pollIntervalMs,
        symbol,
        balance,
        lastPrice,
        ema9,
        ema20,
        ema21,
        ema50,
        ema200,
        macd,
        macdSignal,
        regime,
        volatilityRatio,
        adxNow,
        plusDiNow,
        minusDiNow,
        regimeTf,
        regimeCandles,
        openOrders,
        volumeLast,
        volumeAvg20,
        recentHigh20,
        recentLow20
      })
      res.json(payload)
    } catch (err) {
      logger.error('Error in /api/status', err)
      res.status(500).json({ error: 'Failed to fetch status' })
    }
  })

  // Run a one-off backtest in a separate Node process.
  app.post('/api/backtest', (req, res) => {
    try {
      const { days, timeframe, regime, intrabar, risk, sl, tp, slippage } = req.body || {}
      if (getCurrentBacktest() && getCurrentBacktest().status === 'running') {
        return res.status(409).json({ error: 'Backtest already running' })
      }

      const args = ['src/backtest.js']
      const source = getMarketDataSource()
      if (source === 'live' || source === 'testnet') {
        args.push(`--source=${source}`)
      }
      if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
        args.push(`--days=${days}`)
      }
      if (typeof timeframe === 'string' && /^\d+(m|h|d)$/.test(timeframe)) {
        args.push(`--timeframe=${timeframe}`)
      }
      if (typeof regime === 'boolean') {
        args.push(`--regime=${regime ? 'true' : 'false'}`)
      }
      if (typeof intrabar === 'boolean') {
        args.push(`--intrabar=${intrabar ? 'true' : 'false'}`)
      }
      if (typeof risk === 'number' && Number.isFinite(risk) && risk > 0) {
        args.push(`--risk=${risk}`)
      }
      if (typeof sl === 'number' && Number.isFinite(sl) && sl > 0) {
        args.push(`--sl=${sl}`)
      }
      if (typeof tp === 'number' && Number.isFinite(tp) && tp > 0) {
        args.push(`--tp=${tp}`)
      }
      if (typeof slippage === 'number' && Number.isFinite(slippage) && slippage >= 0 && slippage <= 0.01) {
        args.push(`--slippage=${slippage}`)
      }

      logger.info('HTTP POST /api/backtest spawn', { args })

      const child = spawn(process.execPath, args, { cwd: process.cwd() })
      let stdout = ''
      let stderr = ''
      let stderrBuffer = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.stderr.on('data', (data) => {
        const chunk = data.toString()
        stderr += chunk
        stderrBuffer += chunk
        const lines = stderrBuffer.split('\n')
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const m = line.match(/^PROGRESS\t(\d+)\t(\d+)/)
          if (m) {
            const current = parseInt(m[1], 10)
            const total = parseInt(m[2], 10)
            const cur = getCurrentBacktest()
            if (cur && cur.status === 'running') {
              setCurrentBacktest({
                ...cur,
                progress: {
                  current,
                  total,
                  pct: total > 0 ? Math.round(100 * current / total) : 0
                }
              })
            }
          }
        }
      })

      setCurrentBacktest({
        pid: child.pid,
        args,
        startedAt: new Date().toISOString(),
        status: 'running',
        exitCode: null,
        summary: null,
        error: null
      })

      child.on('error', (err) => {
        logger.error('Backtest process failed to start', err)
        setCurrentBacktest({
          ...(getCurrentBacktest() || {}),
          status: 'failed',
          error: err.message
        })
      })

      child.on('close', (code) => {
        logger.info('Backtest process exited', { code })
        let strategies = []
        let totalPnl = null
        let meta = null
        try {
          const resultMatch = stdout.match(/BACKTEST_RESULT:(.+)/)
          if (resultMatch) {
            const parsed = JSON.parse(resultMatch[1].trim())
            strategies = Array.isArray(parsed.strategies) ? parsed.strategies : []
            totalPnl = typeof parsed.totalPnl === 'number' ? parsed.totalPnl : null
            meta = parsed.meta || null
          }
        } catch (err) {
          logger.warn('Failed to parse backtest output', { err: err.message })
        }

        setCurrentBacktest({
          ...(getCurrentBacktest() || {}),
          status: code === 0 ? 'finished' : 'failed',
          exitCode: code,
          summary: { strategies, totalPnl, meta },
          stdout: stdout.slice(0, 4000),
          stderr: stderr.slice(0, 4000),
          finishedAt: new Date().toISOString()
        })
      })

      res.json({
        status: 'started',
        pid: child.pid,
        args
      })
    } catch (err) {
      logger.error('Error in /api/backtest', err)
      res.status(500).json({ error: 'Backtest failed to start' })
    }
  })

  app.get('/api/backtest/status', (req, res) => {
    const currentBacktest = getCurrentBacktest()
    if (!currentBacktest) {
      return res.json({ status: 'idle' })
    }
    const { child, ...rest } = currentBacktest
    res.json(rest)
  })

  app.post('/api/backtest/stop', (req, res) => {
    try {
      const currentBacktest = getCurrentBacktest()
      if (!currentBacktest || currentBacktest.status !== 'running') {
        return res.status(400).json({ error: 'No running backtest' })
      }
      const pid = currentBacktest.pid
      process.kill(pid, 'SIGTERM')
      setCurrentBacktest({
        ...currentBacktest,
        status: 'stopping'
      })
      res.json({ status: 'stopping', pid })
    } catch (err) {
      logger.error('Error stopping backtest', err)
      res.status(500).json({ error: 'Failed to stop backtest' })
    }
  })

  app.post('/api/manual-buy', async (req, res) => {
    try {
      const { amount: amountParam, unit } = req.body || {}
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]

      if (typeof amountParam === 'number' && amountParam > 0 && (unit === 'base' || unit === 'quote')) {
        const amountBase = unit === 'quote' ? amountParam / lastClose : amountParam
        const exchange = getTradingExchange()
        logger.info(`Manual portfolio BUY: ${amountBase} base (${unit === 'quote' ? amountParam + ' quote' : 'base'})`)
        const order = await exchange.createMarketBuyOrder(symbol, amountBase)
        logger.info(`Market BUY order placed: id=${order.id}, status=${order.status}`)
        return res.json({ status: 'ok', order: { id: order.id, status: order.status }, amountBase })
      }

      const strategyId = 'manual'
      let state = loadState(strategyId)
      logger.info('Manual BUY requested via API (full position)')
      state = await openLongPosition(state, lastClose, strategyId, null, getStrategyBudget())
      saveState(strategyId, state)
      res.json({ status: 'ok', position: state.openPosition })
    } catch (err) {
      logger.error('Error in /api/manual-buy', err)
      res.status(500).json({ error: 'Manual buy failed' })
    }
  })

  app.post('/api/manual-sell', async (req, res) => {
    try {
      const { amount: amountParam, unit } = req.body || {}
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]

      if (typeof amountParam === 'number' && amountParam > 0 && (unit === 'base' || unit === 'quote')) {
        const amountBase = unit === 'quote' ? amountParam / lastClose : amountParam
        const exchange = getTradingExchange()
        logger.info(`Manual portfolio SELL: ${amountBase} base (${unit === 'quote' ? amountParam + ' quote' : 'base'})`)
        const order = await exchange.createMarketSellOrder(symbol, amountBase)
        logger.info(`Market SELL order placed: id=${order.id}, status=${order.status}`)
        return res.json({ status: 'ok', order: { id: order.id, status: order.status }, amountBase })
      }

      const strategyId = 'manual'
      let state = loadState(strategyId)
      if (!state.openPosition) {
        return res.json({ status: 'ok', position: null })
      }
      logger.info('Manual SELL requested via API (close position)')
      state = await closePositionNow(state, lastClose, strategyId, 'Manual close')
      saveState(strategyId, state)
      res.json({ status: 'ok', position: state.openPosition })
    } catch (err) {
      logger.error('Error in /api/manual-sell', err)
      res.status(500).json({ error: 'Manual sell failed' })
    }
  })

  app.get('/api/strategies', (req, res) => {
      if (apiDebug) logger.debug('HTTP GET /api/strategies')
    const runner = loadRunner()
    const list = STRATEGY_IDS.map(id => ({
      id,
      name: getStrategy(id)?.name ?? id,
      running: runner.running.includes(id)
    }))
    res.json({ strategies: list })
  })

  app.post('/api/strategies/:id/start', (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/start', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      const runner = setRunning(id, true)
      res.json({ status: 'ok', running: runner.running })
    } catch (err) {
      logger.error('Error starting strategy', err)
      res.status(500).json({ error: 'Failed to start' })
    }
  })

  app.post('/api/strategies/:id/stop', (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/stop', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      const runner = setRunning(id, false)
      res.json({ status: 'ok', running: runner.running })
    } catch (err) {
      logger.error('Error stopping strategy', err)
      res.status(500).json({ error: 'Failed to stop' })
    }
  })

  app.post('/api/strategies/start-all', (req, res) => {
    try {
      if (apiDebug) logger.debug('HTTP POST /api/strategies/start-all')
      const runner = setAllRunning(true)
      res.json({ status: 'ok', running: runner.running })
    } catch (err) {
      logger.error('Error starting all strategies', err)
      res.status(500).json({ error: 'Failed to start all' })
    }
  })

  app.post('/api/strategies/stop-all', (req, res) => {
    try {
      if (apiDebug) logger.debug('HTTP POST /api/strategies/stop-all')
      const runner = setAllRunning(false)
      res.json({ status: 'ok', running: runner.running })
    } catch (err) {
      logger.error('Error stopping all strategies', err)
      res.status(500).json({ error: 'Failed to stop all' })
    }
  })

  app.post('/api/strategies/:id/buy', async (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/buy', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      let state = loadState(id)
      if (state.openPosition) {
        return res.status(400).json({ error: 'Strategy already has an open position', position: state.openPosition })
      }
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]
      logger.info(`Strategy BUY requested via API: ${id}`)
      state = await openLongPosition(state, lastClose, id, null, getStrategyBudget())
      saveState(id, state)
      res.json({ status: 'ok', position: state.openPosition })
    } catch (err) {
      logger.error('Error in strategy buy', err)
      res.status(500).json({ error: 'Buy failed' })
    }
  })

  app.post('/api/strategies/:id/short', async (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/short', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      let state = loadState(id)
      if (state.openPosition) {
        return res.status(400).json({ error: 'Strategy already has an open position', position: state.openPosition })
      }
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]
      logger.info(`Strategy SHORT requested via API: ${id}`)
      state = await openShortPosition(state, lastClose, id, null, getStrategyBudget())
      saveState(id, state)
      res.json({ status: 'ok', position: state.openPosition })
    } catch (err) {
      logger.error('Error in strategy short', err)
      res.status(500).json({ error: 'Short failed' })
    }
  })

  app.post('/api/close-all', async (req, res) => {
    try {
      if (apiDebug) logger.debug('HTTP POST /api/close-all')
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]
      const closed = []
      for (const id of STRATEGY_IDS) {
        let state = loadState(id)
        if (!state.openPosition) continue
        logger.info(`Close-all: closing position for strategy ${id}`)
        state = await closePositionNow(state, lastClose, id, 'Close all')
        saveState(id, state)
        closed.push(id)
      }
      logger.info('Close-all finished', { closed: closed.length, strategies: closed })
      res.json({ status: 'ok', closed: closed.length, strategies: closed })
    } catch (err) {
      logger.error('Error in close-all', err)
      res.status(500).json({ error: 'Close all failed' })
    }
  })

  app.post('/api/strategies/:id/sell', async (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/sell', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      let state = loadState(id)
      if (!state.openPosition) {
        return res.json({ status: 'ok', position: null, message: 'No position to close' })
      }
      const ohlcv = await fetchMarketData(2)
      const lastClose = ohlcv[ohlcv.length - 1][4]
      logger.info(`Strategy SELL requested via API: ${id}`)
      state = await closePositionNow(state, lastClose, id, 'Manual close')
      saveState(id, state)
      res.json({ status: 'ok', position: state.openPosition })
    } catch (err) {
      logger.error('Error in strategy sell', err)
      res.status(500).json({ error: 'Sell failed' })
    }
  })

  app.post('/api/strategies/:id/reset-pnl', (req, res) => {
    try {
      const { id } = req.params
      if (apiDebug) logger.debug('HTTP POST /api/strategies/:id/reset-pnl', { id })
      if (!STRATEGY_IDS.includes(id)) {
        return res.status(400).json({ error: 'Unknown strategy' })
      }
      const state = resetPnlState(loadState(id))
      saveState(id, state)
      logger.info(`PnL + win/loss counters + trade history reset for strategy: ${id}`)
      res.json({
        status: 'ok',
        realizedPnl: 0,
        wins: 0,
        losses: 0,
        positionsOpened: 0
      })
    } catch (err) {
      logger.error('Error resetting PnL', err)
      res.status(500).json({ error: 'Reset failed' })
    }
  })

  app.post('/api/reset-all-pnl', (req, res) => {
    try {
      if (apiDebug) logger.debug('HTTP POST /api/reset-all-pnl')
      for (const id of STRATEGY_IDS) {
        saveState(id, resetPnlState(loadState(id)))
      }
      logger.info('PnL + win/loss counters + trade history reset for all strategies')
      res.json({ status: 'ok' })
    } catch (err) {
      logger.error('Error resetting all PnL', err)
      res.status(500).json({ error: 'Reset failed' })
    }
  })

  app.post('/api/config', (req, res) => {
    try {
      const { autoTradingEnabled, riskPerTrade, stopLossPct, takeProfitPct } = req.body || {}
      if (apiDebug) logger.debug('HTTP POST /api/config', { autoTradingEnabled, riskPerTrade, stopLossPct, takeProfitPct })

      for (const id of STRATEGY_IDS) {
        let state = loadState(id)
        if (typeof autoTradingEnabled === 'boolean') {
          state.autoTradingEnabled = autoTradingEnabled
        }
        state.runtimeConfig = {
          ...(state.runtimeConfig || {}),
          ...(typeof riskPerTrade === 'number' ? { riskPerTrade } : {}),
          ...(typeof stopLossPct === 'number' ? { stopLossPct } : {}),
          ...(typeof takeProfitPct === 'number' ? { takeProfitPct } : {})
        }
        saveState(id, state)
      }

      const firstState = loadState(STRATEGY_IDS[0])
      const effective = getEffectiveTradingConfig(firstState)
      logger.info(
        `Runtime config updated via API: riskPerTrade=${effective.riskPerTrade}, ` +
          `stopLossPct=${effective.stopLossPct}, takeProfitPct=${effective.takeProfitPct}`
      )

      res.json({
        status: 'ok',
        runtimeConfig: firstState.runtimeConfig
      })
    } catch (err) {
      logger.error('Error in /api/config', err)
      res.status(500).json({ error: 'Failed to update config' })
    }
  })

  app.post('/api/config/regime-filter', (req, res) => {
    try {
      const { enabled } = req.body || {}
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Body must include { enabled: true|false }' })
      }
      setRegimeFilterEnabled(enabled)
      res.json({ status: 'ok', regimeFilterEnabled: enabled })
    } catch (err) {
      logger.error('Error in /api/config/regime-filter', err)
      res.status(500).json({ error: 'Failed to update regime filter' })
    }
  })

  app.post('/api/config/reset', (req, res) => {
    try {
      for (const id of STRATEGY_IDS) {
        const state = loadState(id)
        state.runtimeConfig = {
          ...(state.runtimeConfig || {}),
          riskPerTrade: null,
          stopLossPct: null,
          takeProfitPct: null
        }
        saveState(id, state)
      }
      const firstState = loadState(STRATEGY_IDS[0])
      const effective = getEffectiveTradingConfig(firstState)
      logger.info(
        `Runtime risk config reset to .env defaults: riskPerTrade=${effective.riskPerTrade}, ` +
          `stopLossPct=${effective.stopLossPct}, takeProfitPct=${effective.takeProfitPct}`
      )
      res.json({ status: 'ok', runtimeConfig: firstState.runtimeConfig })
    } catch (err) {
      logger.error('Error in /api/config/reset', err)
      res.status(500).json({ error: 'Failed to reset config' })
    }
  })

  app.get('/api/trades', async (req, res) => {
    try {
      const exchange = getTradingExchange()
      const limit = Math.min(Number(req.query.limit) || 50, 500)
      if (apiDebug) logger.debug('HTTP GET /api/trades', { limit })
      if (apiDebug) logger.debug('exchange.fetchMyTrades request', { symbol, limit })
      const trades = await exchange.fetchMyTrades(symbol, undefined, limit)
      if (apiDebug) logger.debug('exchange.fetchMyTrades response', { count: trades.length })
      const orderToStrategy = getOrderStrategyMap()

      const withFees = trades.map(t => {
        const orderId = t.order ?? t.orderId ?? null
        const raw = orderId ? orderToStrategy[String(orderId)] : null
        const strategyId = typeof raw === 'string' ? raw : (raw?.strategyId ?? null)
        const reason = typeof raw === 'object' && raw != null ? (raw.reason ?? null) : null
        const detail = typeof raw === 'object' && raw != null && raw.detail ? raw.detail : null
        const orderPnl = typeof raw === 'object' && raw != null && typeof raw.pnl === 'number' ? raw.pnl : null
        const strategy = strategyId ? getStrategy(strategyId) : null
        return {
          id: t.id,
          orderId,
          timestamp: t.timestamp,
          side: t.side,
          amount: t.amount,
          price: t.price,
          cost: t.cost,
          fee: t.fee ? { cost: t.fee.cost ?? 0, currency: t.fee.currency ?? 'USDT' } : null,
          strategyId: strategyId ?? null,
          strategyName: strategy?.name ?? strategyId ?? null,
          reason: reason ?? null,
          detail: detail ?? null,
          orderPnl
        }
      })

      const totalFeeUsdt = withFees.reduce((sum, t) => {
        if (t.fee && (t.fee.currency === 'USDT' || t.fee.currency === 'BNB')) {
          return sum + Number(t.fee.cost || 0)
        }
        return sum
      }, 0)

      res.json({
        trades: withFees.reverse(),
        totalFeeEstimate: totalFeeUsdt,
        feeCurrency: 'USDT'
      })
    } catch (err) {
      logger.error('Error in /api/trades', err)
      res.status(500).json({ error: 'Failed to fetch trades' })
    }
  })

  // Market data source toggle (live vs testnet) for candles / regime / backtests.
  app.get('/api/market-data-source', (req, res) => {
    try {
      const source = getMarketDataSource()
      res.json({ source })
    } catch (err) {
      logger.error('Error in GET /api/market-data-source', err)
      res.status(500).json({ error: 'Failed to get market data source' })
    }
  })

  app.post('/api/market-data-source', async (req, res) => {
    try {
      const { source } = req.body || {}
      if (source !== 'live' && source !== 'testnet') {
        return res.status(400).json({ error: 'source must be "live" or "testnet"' })
      }
      setMarketDataSource(source)
      res.json({ source: getMarketDataSource() })
    } catch (err) {
      logger.error('Error in POST /api/market-data-source', err)
      res.status(500).json({ error: 'Failed to set market data source' })
    }
  })

  app.get('/api/candles', async (req, res) => {
    try {
      const maxCandles = config.trading.closedTradesHistoryLimit ?? 500
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 200), maxCandles)
      if (apiDebug) logger.debug('HTTP GET /api/candles', { limit, source: getMarketDataSource() })
      const ohlcv = await fetchMarketData(limit)

      let lastValidClose = null
      const closes = ohlcv.map(c => {
        const raw = Number(c[4])
        const invalid = !Number.isFinite(raw) || raw <= 0
        const outlier = lastValidClose != null && raw > 0 &&
          (raw < lastValidClose * 0.5 || raw > lastValidClose * 2)
        if (!invalid && !outlier) {
          lastValidClose = raw
          return raw
        }
        return lastValidClose ?? raw
      })

      const ema7 = calculateEMA(closes, 7)
      const ema9 = calculateEMA(closes, 9)
      const ema20 = calculateEMA(closes, 20)
      const ema21 = calculateEMA(closes, 21)
      const ema25 = calculateEMA(closes, 25)
      const ema50 = calculateEMA(closes, 50)
      const ema99 = calculateEMA(closes, 99)
      const ema200 = calculateEMA(closes, 200)
      const { macdLine, signalLine, histogram } = calculateMACD(closes, 12, 26, 9)
      const rsi14 = calculateRSI(closes, 14)
      const { middle: bbMid, upper: bbUpper, lower: bbLower } = calculateBollinger(closes, 20, 2)

      const result = ohlcv.map((candle, idx) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: closes[idx],
        volume: candle[5],
        ema7: ema7[idx] ?? null,
        ema9: ema9[idx] ?? null,
        ema20: ema20[idx] ?? null,
        ema21: ema21[idx] ?? null,
        ema25: ema25[idx] ?? null,
        ema50: ema50[idx] ?? null,
        ema99: ema99[idx] ?? null,
        ema200: ema200[idx] ?? null,
        macd: macdLine[idx] ?? null,
        macdSignal: signalLine[idx] ?? null,
        macdHistogram: histogram[idx] ?? null,
        rsi14: rsi14[idx] ?? null,
        bbMid: bbMid[idx] ?? null,
        bbUpper: bbUpper[idx] ?? null,
        bbLower: bbLower[idx] ?? null
      }))

      const toSend = result.length > 1 ? result.slice(0, -1) : result
      res.json(toSend)
    } catch (err) {
      logger.error('Error in /api/candles', err)
      res.status(500).json({ error: 'Failed to fetch candles' })
    }
  })

  app.use(express.static(path.join(__dirname, '../public')))

  return app
}

export function getApiPort () {
  return apiPort
}
