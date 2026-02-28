import { state } from './state.js'

const Chart = window.Chart

export async function fetchCandles () {
  const res = await fetch('/api/candles?limit=5000')
  if (!res.ok) throw new Error('Failed to fetch candles')
  return res.json()
}

export function renderChart (candles) {
  if (Array.isArray(candles) && candles.length) {
    state.lastCandles = candles
  }
  const src = state.lastCandles || []
  let view = src
  if (state.customWindow && src.length) {
    const start = Math.max(0, state.customWindow.start)
    const end = Math.min(src.length, state.customWindow.end)
    view = src.slice(start, end)
  } else if (state.chartWindowSize && state.chartWindowSize !== 'all' && src.length > state.chartWindowSize) {
    view = src.slice(-state.chartWindowSize)
  }
  if (!view.length) return

  const labels = view.map(c =>
    new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
  const closes = view.map(c => c.close)
  const ema9 = view.map(c => c.ema9)
  const ema20 = view.map(c => c.ema20)
  const ema21 = view.map(c => c.ema21)
  const ema50 = view.map(c => c.ema50)
  const ema200 = view.map(c => c.ema200)
  const macd = view.map(c => c.macd)
  const macdSignal = view.map(c => c.macdSignal)
  const macdHistogram = view.map(c => c.macdHistogram)
  const rsi = view.map(c => c.rsi14)
  const bbMid = view.map(c => c.bbMid)
  const bbUpper = view.map(c => c.bbUpper)
  const bbLower = view.map(c => c.bbLower)

  const getStrategyName = (id) => (state.latestStrategies.find(s => s.id === id) || {}).name || id

  let priceDatasets
  switch (state.selectedStrategyId) {
    case 'price_vs_ema':
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 20', data: ema20, borderColor: '#e879f9', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 50', data: ema50, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 }
      ]
      break
    case 'multi_ema':
    case 'ema_fast_crossover':
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 9', data: ema9, borderColor: '#a78bfa', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 21', data: ema21, borderColor: '#f472b6', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 50', data: ema50, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 }
      ]
      break
    case 'bb_mean_revert':
    case 'bb_squeeze':
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'BB Upper', data: bbUpper, borderColor: '#f97316', tension: 0.2, pointRadius: 0 },
        { label: 'BB Middle', data: bbMid, borderColor: '#e5e7eb', tension: 0.2, pointRadius: 0 },
        { label: 'BB Lower', data: bbLower, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 }
      ]
      break
    case 'rsi_pullback':
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 50', data: ema50, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 200', data: ema200, borderColor: '#f97316', tension: 0.2, pointRadius: 0 }
      ]
      break
    case 'ema_crossover':
    case 'atr_trend':
    case 'macd':
    case 'macd_histogram_long':
    case 'volume_ema_crossover':
    case 'rsi_macd_combo':
    case 'donchian_breakout':
    case 'atr_breakout':
    case 'range_bounce':
    case 'multi_tf_trend':
    case 'short_trend':
    case 'short_breakdown':
    case 'short_rejection':
    case 'short_overbought':
    case 'short_macd':
    case 'short_macd_histogram':
    case 'stochastic_oversold':
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 50', data: ema50, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 200', data: ema200, borderColor: '#f97316', tension: 0.2, pointRadius: 0 }
      ]
      break
    default:
      priceDatasets = [
        { label: 'Close', data: closes, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 9', data: ema9, borderColor: '#a78bfa', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 20', data: ema20, borderColor: '#e879f9', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 21', data: ema21, borderColor: '#f472b6', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 50', data: ema50, borderColor: '#22c55e', tension: 0.2, pointRadius: 0 },
        { label: 'EMA 200', data: ema200, borderColor: '#f97316', tension: 0.2, pointRadius: 0 }
      ]
      break
  }

  const entryPoints = new Array(view.length).fill(null)
  const exitPoints = new Array(view.length).fill(null)
  const entryStrategiesByIndex = {}
  const exitStrategiesByIndex = {}
  if (Array.isArray(state.latestTrades) && state.latestTrades.length) {
    state.latestTrades.forEach(t => {
      if (!t.timestamp) return
      const ts = t.timestamp
      let idx = view.findIndex(c => c.timestamp >= ts)
      if (idx === -1) idx = view.length - 1
      const y = view[idx]?.close
      if (!Number.isFinite(y)) return
      const strat = { id: t.strategyId, name: getStrategyName(t.strategyId) }
      if (t.side === 'buy') {
        entryPoints[idx] = y
        if (!entryStrategiesByIndex[idx]) entryStrategiesByIndex[idx] = []
        entryStrategiesByIndex[idx].push(strat)
      } else if (t.side === 'sell') {
        exitPoints[idx] = y
        if (!exitStrategiesByIndex[idx]) exitStrategiesByIndex[idx] = []
        exitStrategiesByIndex[idx].push(strat)
      }
    })
  }
  priceDatasets.push(
    { label: 'Entries', data: entryPoints, borderColor: '#ffffff', backgroundColor: '#4ade80', pointRadius: 8, pointBorderWidth: 2, showLine: false },
    { label: 'Exits', data: exitPoints, borderColor: '#ffffff', backgroundColor: '#f87171', pointRadius: 8, pointBorderWidth: 2, showLine: false }
  )

  const priceData = { labels, datasets: priceDatasets }
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { labels: { color: '#e5e7eb', boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.dataset.label || ''
            const val = context.parsed?.y
            let line = label + ': ' + (typeof val === 'number' ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : val)
            const strategies = context.dataset.label === 'Entries'
              ? (context.chart._entryStrategiesByIndex || {})[context.dataIndex]
              : context.dataset.label === 'Exits'
                ? (context.chart._exitStrategiesByIndex || {})[context.dataIndex]
                : null
            if (strategies && strategies.length) {
              line += ' — ' + strategies.map(s => s.name || s.id).join(', ')
            }
            return line
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { display: false } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } }
    }
  }

  const ctxPrice = document.getElementById('price-chart').getContext('2d')
  if (state.priceChart) {
    state.priceChart.data = priceData
    state.priceChart._entryStrategiesByIndex = entryStrategiesByIndex
    state.priceChart._exitStrategiesByIndex = exitStrategiesByIndex
    state.priceChart.update()
  } else {
    state.priceChart = new Chart(ctxPrice, { type: 'line', data: priceData, options: chartOptions })
    state.priceChart._entryStrategiesByIndex = entryStrategiesByIndex
    state.priceChart._exitStrategiesByIndex = exitStrategiesByIndex
  }

  const lowerY = state.selectedStrategyId === 'rsi_pullback' || state.selectedStrategyId === 'short_overbought' || state.selectedStrategyId === 'stochastic_oversold' ? rsi : macd
  const entryPointsLower = new Array(view.length).fill(null)
  const exitPointsLower = new Array(view.length).fill(null)
  const entryStrategiesLowerByIndex = {}
  const exitStrategiesLowerByIndex = {}
  if (Array.isArray(state.latestTrades) && state.latestTrades.length && Array.isArray(lowerY)) {
    state.latestTrades.forEach(t => {
      if (!t.timestamp) return
      let idx = view.findIndex(c => c.timestamp >= t.timestamp)
      if (idx === -1) idx = view.length - 1
      const y = lowerY[idx]
      if (y == null || !Number.isFinite(y)) return
      const strat = { id: t.strategyId, name: getStrategyName(t.strategyId) }
      if (t.side === 'buy') {
        entryPointsLower[idx] = y
        if (!entryStrategiesLowerByIndex[idx]) entryStrategiesLowerByIndex[idx] = []
        entryStrategiesLowerByIndex[idx].push(strat)
      } else if (t.side === 'sell') {
        exitPointsLower[idx] = y
        if (!exitStrategiesLowerByIndex[idx]) exitStrategiesLowerByIndex[idx] = []
        exitStrategiesLowerByIndex[idx].push(strat)
      }
    })
  }
  let macdData
  if (state.selectedStrategyId === 'rsi_pullback' || state.selectedStrategyId === 'short_overbought' || state.selectedStrategyId === 'stochastic_oversold') {
    macdData = {
      labels,
      datasets: [
        { label: 'RSI(14)', data: rsi, borderColor: '#eab308', tension: 0.2, pointRadius: 0 },
        { label: 'Entries', data: entryPointsLower, borderColor: '#ffffff', backgroundColor: '#4ade80', pointRadius: 8, pointBorderWidth: 2, showLine: false },
        { label: 'Exits', data: exitPointsLower, borderColor: '#ffffff', backgroundColor: '#f87171', pointRadius: 8, pointBorderWidth: 2, showLine: false }
      ]
    }
  } else {
    macdData = {
      labels,
      datasets: [
        { label: 'MACD', data: macd, borderColor: '#38bdf8', tension: 0.2, pointRadius: 0 },
        { label: 'Signal', data: macdSignal, borderColor: '#f97316', tension: 0.2, pointRadius: 0 },
        { label: 'Histogram', data: macdHistogram, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.2)', tension: 0.2, pointRadius: 0, fill: true },
        { label: 'Entries', data: entryPointsLower, borderColor: '#ffffff', backgroundColor: '#4ade80', pointRadius: 8, pointBorderWidth: 2, showLine: false },
        { label: 'Exits', data: exitPointsLower, borderColor: '#ffffff', backgroundColor: '#f87171', pointRadius: 8, pointBorderWidth: 2, showLine: false }
      ]
    }
  }

  const ctxMacd = document.getElementById('macd-chart').getContext('2d')
  if (state.macdChart) {
    state.macdChart.data = macdData
    state.macdChart._entryStrategiesByIndex = entryStrategiesLowerByIndex
    state.macdChart._exitStrategiesByIndex = exitStrategiesLowerByIndex
    state.macdChart.update()
  } else {
    state.macdChart = new Chart(ctxMacd, { type: 'line', data: macdData, options: chartOptions })
    state.macdChart._entryStrategiesByIndex = entryStrategiesLowerByIndex
    state.macdChart._exitStrategiesByIndex = exitStrategiesLowerByIndex
  }
}
