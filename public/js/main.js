import { formatPrice, formatAmount, formatQuote, formatPnl, formatBoolPill, escapeHtml } from './utils.js'
import { fetchStatus, postJson } from './api.js'

const Chart = window.Chart

let priceChart = null

let macdChart = null
let analysisPnlChart = null
let analysisWinrateChart = null
let analysisEquityChart = null
let analysisSortBy = 'totalPnl'
let analysisSortDesc = true
let analysisTimeRange = 'sinceReset'
let analysisTradesData = {}
let selectedStrategyId = null
let latestTrades = []
let chartWindowSize = 500
let lastCandles = []
let customWindow = null
let activityEvents = []
let lastStrategySnapshot = {}
let activityInitialized = false
let latestStrategies = []

function updateChartFocusLabel() {
  const el = document.getElementById('chart-focus-label')
  if (!el) return
  if (!selectedStrategyId) {
    el.textContent = '— (select a strategy to focus chart)'
    el.style.color = '#9ca3af'
    return
  }
  const strat = latestStrategies.find(s => s.id === selectedStrategyId)
  const name = strat ? (strat.name || strat.id) : selectedStrategyId
  el.textContent = name
  el.style.color = '#22c55e'
}

function strategyDetailHtml(s) {
  if (!s) return ''
  const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const desc = (s.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const posText = s.position?.open ? s.position.side + ' ' + formatAmount(s.position.amount) : 'Flat'
  const pnlColor = (v) => (v ?? 0) >= 0 ? '#22c55e' : '#ef4444'
  const r = s.realizedPnl ?? 0
  const u = s.unrealizedPnl ?? 0
  const wins = s.wins ?? 0
  const losses = s.losses ?? 0
  const exposurePct = s.exposure != null ? (s.exposure * 100).toFixed(1) + '%' : '–'
  const hasPosition = s.position?.open === true
  const isShort = s.id && s.id.startsWith('short_')
  let actions = ''
  if (s.id !== 'manual') {
    actions += '<button class="secondary strategy-btn" data-id="' + s.id + '" data-running="' + s.running + '">' + (s.running ? 'Stop' : 'Start') + '</button> '
  }
  if (!isShort) {
    actions += '<button class="primary strategy-buy-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Open long</button> '
  } else {
    actions += '<button class="primary strategy-short-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Open short</button> '
  }
  actions += '<button class="danger strategy-sell-btn" data-id="' + s.id + '"' + (!hasPosition ? ' disabled' : '') + '>Close</button> '
  actions += '<button class="secondary strategy-reset-pnl-btn" data-id="' + s.id + '">Reset stats & trades</button>'
  return '<div class="section-title">' + name + '</div>' +
    (desc ? '<p style="margin:0.5rem 0; font-size:0.85rem; color:#9ca3af">' + desc + '</p>' : '') +
    '<div class="row"><span class="label">Status</span><span class="value">' + (s.running ? 'Running' : 'Stopped') + '</span></div>' +
    '<div class="row"><span class="label">W/L</span><span class="value">' + wins + ' / ' + losses + '</span></div>' +
    '<div class="row"><span class="label">Realized</span><span class="value" style="color:' + pnlColor(r) + '">' + formatPnl(s.realizedPnl).replace(' USDT', '') + '</span></div>' +
    '<div class="row"><span class="label">Unrealized</span><span class="value" style="color:' + pnlColor(u) + '">' + formatPnl(s.unrealizedPnl).replace(' USDT', '') + '</span></div>' +
    '<div class="row"><span class="label">Exposure</span><span class="value">' + exposurePct + '</span></div>' +
    '<div class="row"><span class="label">Position</span><span class="value">' + posText + '</span></div>' +
    '<div class="row"><span class="label">Last decision</span><span class="value">' + (s.lastDecision || '–') + '</span></div>' +
    '<div style="margin-top:0.75rem">' + actions + '</div>'
}

function addActivityEvent (message, level = 'info') {
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const item = { time: timeStr, message, level }
  activityEvents.unshift(item)
  if (activityEvents.length > 50) activityEvents.pop()
  const html = activityEvents
    .map(ev => '<div class="activity-item">' +
      '<span class="activity-time">' + escapeHtml(ev.time) + '</span>' +
      '<span class="activity-message">' + escapeHtml(ev.message) + '</span>' +
    '</div>')
    .join('')
  const listEl = document.getElementById('activity-list')
  if (listEl) listEl.innerHTML = html
  const overviewEl = document.getElementById('activity-overview')
  if (overviewEl) overviewEl.innerHTML = activityEvents.slice(0, 5).map(ev => '<div class="activity-item">' +
    '<span class="activity-time">' + escapeHtml(ev.time) + '</span>' +
    '<span class="activity-message">' + escapeHtml(ev.message) + '</span></div>').join('') || '<small>No recent events.</small>'
  showToast(message, level)
}

let audioCtx = null

function playNotificationSound () {
  try {
    const AudioContextCls = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCls) return
    if (!audioCtx) {
      audioCtx = new AudioContextCls()
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.08
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    const now = audioCtx.currentTime
    osc.start(now)
    osc.stop(now + 0.15)
  } catch (e) {
    console.error('Notification sound error', e)
  }
}

function showToast (message, level = 'info') {
  const container = document.getElementById('toast-container')
  if (!container) return
  const div = document.createElement('div')
  div.className = 'toast toast-' + (level === 'success' || level === 'error' ? level : 'info')
  div.textContent = message
  container.appendChild(div)
  // trigger animation
  requestAnimationFrame(() => {
    div.classList.add('toast-show')
    playNotificationSound()
  })
  setTimeout(() => {
    div.classList.remove('toast-show')
    setTimeout(() => {
      if (div.parentNode === container) {
        container.removeChild(div)
      }
    }, 200)
  }, 3500)
}

// Restore persisted chart / selection state
try {
  const savedWindow = localStorage.getItem('chartWindowSize')
  if (savedWindow) {
    chartWindowSize = savedWindow === 'all' ? 'all' : Number(savedWindow)
  }
  const savedSelected = localStorage.getItem('selectedStrategyId')
  if (savedSelected) {
    selectedStrategyId = savedSelected
  }
  const savedStart = localStorage.getItem('customWindowStart')
  const savedEnd = localStorage.getItem('customWindowEnd')
  if (savedStart != null && savedEnd != null) {
    const s = Number(savedStart)
    const e = Number(savedEnd)
    if (!isNaN(s) && !isNaN(e) && e > s) {
      customWindow = { start: s, end: e }
    }
  }
} catch (e) {
  console.error('Failed to restore chart state', e)
}

async function fetchCandles() {
  const res = await fetch('/api/candles?limit=5000')
  if (!res.ok) throw new Error('Failed to fetch candles')
  return res.json()
}

function renderChart(candles) {
  if (Array.isArray(candles) && candles.length) {
    lastCandles = candles
  }
  const src = lastCandles || []
  let view = src
  if (customWindow && src.length) {
    const start = Math.max(0, customWindow.start)
    const end = Math.min(src.length, customWindow.end)
    view = src.slice(start, end)
  } else if (chartWindowSize && chartWindowSize !== 'all' && src.length > chartWindowSize) {
    view = src.slice(-chartWindowSize)
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

  let priceDatasets
  switch (selectedStrategyId) {
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

  // Markers for all entries/exits in view (all strategies); strategy lookups for tooltips
  const getStrategyName = (id) => (latestStrategies.find(s => s.id === id) || {}).name || id
  const entryPoints = new Array(view.length).fill(null)
  const exitPoints = new Array(view.length).fill(null)
  const entryStrategiesByIndex = {}
  const exitStrategiesByIndex = {}
  if (Array.isArray(latestTrades) && latestTrades.length) {
    latestTrades.forEach(t => {
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
  if (priceChart) {
    priceChart.data = priceData
    priceChart._entryStrategiesByIndex = entryStrategiesByIndex
    priceChart._exitStrategiesByIndex = exitStrategiesByIndex
    priceChart.update()
  } else {
    priceChart = new Chart(ctxPrice, { type: 'line', data: priceData, options: chartOptions })
    priceChart._entryStrategiesByIndex = entryStrategiesByIndex
    priceChart._exitStrategiesByIndex = exitStrategiesByIndex
  }

  let macdData
  const lowerY = selectedStrategyId === 'rsi_pullback' || selectedStrategyId === 'short_overbought' || selectedStrategyId === 'stochastic_oversold' ? rsi : macd
  const entryPointsLower = new Array(view.length).fill(null)
  const exitPointsLower = new Array(view.length).fill(null)
  const entryStrategiesLowerByIndex = {}
  const exitStrategiesLowerByIndex = {}
  if (Array.isArray(latestTrades) && latestTrades.length && Array.isArray(lowerY)) {
    latestTrades.forEach(t => {
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
  if (selectedStrategyId === 'rsi_pullback' || selectedStrategyId === 'short_overbought' || selectedStrategyId === 'stochastic_oversold') {
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
  if (macdChart) {
    macdChart.data = macdData
    macdChart._entryStrategiesByIndex = entryStrategiesLowerByIndex
    macdChart._exitStrategiesByIndex = exitStrategiesLowerByIndex
    macdChart.update()
  } else {
    macdChart = new Chart(ctxMacd, { type: 'line', data: macdData, options: chartOptions })
    macdChart._entryStrategiesByIndex = entryStrategiesLowerByIndex
    macdChart._exitStrategiesByIndex = exitStrategiesLowerByIndex
  }
}

function updatePositionActivity (strategies, market) {
  const nextSnapshot = {}
  const lastPrice = market?.lastPrice

  // On first call after page load, just take a snapshot and do NOT emit events
  if (!activityInitialized) {
    strategies.forEach(s => {
      const pos = s.position || { open: false }
      nextSnapshot[s.id] = {
        open: !!pos.open,
        side: pos.side || null,
        amount: pos.amount || 0,
        entryPrice: pos.entryPrice || null,
        realizedPnl: s.realizedPnl ?? 0
      }
    })
    lastStrategySnapshot = nextSnapshot
    activityInitialized = true
    return
  }

  // Subsequent calls: compare with previous snapshot and emit open/close events
  strategies.forEach(s => {
    const id = s.id
    const name = s.name || s.id
    const pos = s.position || { open: false }
    const curr = {
      open: !!pos.open,
      side: pos.side || null,
      amount: pos.amount || 0,
      entryPrice: pos.entryPrice || null,
      realizedPnl: s.realizedPnl ?? 0
    }
    const prev = lastStrategySnapshot[id]

    if (prev && !prev.open && curr.open) {
      if (curr.open && curr.amount > 0) {
        const sideLabel = (curr.side || 'long').toUpperCase()
        const msg = `Opened ${sideLabel} ${formatAmount(curr.amount)} @ ${formatPrice(curr.entryPrice)} (${name})`
        addActivityEvent(msg, 'success')
      }
    } else if (prev && prev.open && !curr.open) {
      const deltaPnl = (curr.realizedPnl ?? 0) - (prev.realizedPnl ?? 0)
      const sideLabel = (prev.side || 'long').toUpperCase()
      const level = deltaPnl >= 0 ? 'success' : 'error'
      const pnlText = formatPnl(deltaPnl).replace(' USDT', '')
      const priceText = lastPrice != null ? ` @ ${formatPrice(lastPrice)}` : ''
      const msg = `Closed ${sideLabel} ${formatAmount(prev.amount)}${priceText} (${name}), PnL ${pnlText}`
      addActivityEvent(msg, level)
    }

    nextSnapshot[id] = curr
  })

  lastStrategySnapshot = nextSnapshot
}

function getMetricsForRange (s) {
  if (analysisTimeRange === 'all') {
    return {
      realizedPnl: s.realizedPnl ?? 0,
      unrealizedPnl: s.unrealizedPnl ?? 0,
      totalPnl: s.totalPnl ?? 0,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      trades: s.trades ?? 0,
      winRate: s.winRate,
      avgWin: s.avgWin,
      avgLoss: s.avgLoss,
      exposure: s.exposure,
      avgTradeDurationMs: s.avgTradeDurationMs,
      maxDrawdown: s.maxDrawdown
    }
  }
  const block = analysisTimeRange === 'sinceReset' ? (s.sinceReset || {}) : analysisTimeRange === 'last7d' ? (s.last7d || {}) : (s.last30d || {})
  const real = block.realizedPnl ?? 0
  const unreal = s.unrealizedPnl ?? 0
  return {
    realizedPnl: real,
    unrealizedPnl: unreal,
    totalPnl: real + unreal,
    wins: block.wins ?? 0,
    losses: block.losses ?? 0,
    trades: block.trades ?? 0,
    winRate: block.winRate ?? null,
    avgWin: block.avgWin ?? null,
    avgLoss: block.avgLoss ?? null,
    exposure: s.exposure,
    avgTradeDurationMs: s.avgTradeDurationMs,
    maxDrawdown: s.maxDrawdown
  }
}

function getFilteredHistoryForRange (s) {
  const history = Array.isArray(s.closedTradesHistory) ? s.closedTradesHistory : []
  if (analysisTimeRange === 'all') return history
  const now = Date.now()
  const now7d = now - 7 * 24 * 60 * 60 * 1000
  const now30d = now - 30 * 24 * 60 * 60 * 1000
  if (analysisTimeRange === 'sinceReset' && s.pnlResetAt) {
    const t0 = new Date(s.pnlResetAt).getTime()
    return history.filter(e => new Date(e.timestamp).getTime() >= t0)
  }
  if (analysisTimeRange === 'last7d') return history.filter(e => new Date(e.timestamp).getTime() >= now7d)
  if (analysisTimeRange === 'last30d') return history.filter(e => new Date(e.timestamp).getTime() >= now30d)
  return history
}

function computeSharpe (entries) {
  if (!entries.length) return null
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  if (std === 0) return null
  return mean / std
}

function computeSortino (entries) {
  if (!entries.length) return null
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const negativeSquared = pnls.filter(p => p < 0).map(p => p * p)
  if (negativeSquared.length === 0) return mean > 0 ? Infinity : (mean < 0 ? -Infinity : null)
  const downsideVariance = negativeSquared.reduce((a, b) => a + b, 0) / negativeSquared.length
  const downsideStd = Math.sqrt(downsideVariance)
  if (downsideStd === 0) return null
  return mean / downsideStd
}

function computeExtraMetrics (entries, s) {
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const sumWins = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0)
  const sumLosses = pnls.filter(p => p < 0).reduce((a, b) => a + b, 0)
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / Math.abs(sumLosses)
  const expectancy = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null
  const winsOnly = pnls.filter(p => p > 0)
  const lossesOnly = pnls.filter(p => p < 0)
  const maxWin = winsOnly.length ? Math.max(...winsOnly) : null
  const maxLoss = lossesOnly.length ? Math.min(...lossesOnly) : null
  const sortino = computeSortino(entries)
  const now = Date.now()
  let daysInRange = 1
  if (analysisTimeRange === 'last7d') daysInRange = 7
  else if (analysisTimeRange === 'last30d') daysInRange = 30
  else if (analysisTimeRange === 'sinceReset' && s.pnlResetAt) daysInRange = Math.max(1, (now - new Date(s.pnlResetAt).getTime()) / (86400 * 1000))
  else if (entries.length >= 2) {
    const ts = entries.map(e => new Date(e.timestamp).getTime())
    daysInRange = Math.max(1, (Math.max(...ts) - Math.min(...ts)) / (86400 * 1000))
  }
  const tradesPerDay = entries.length && daysInRange > 0 ? entries.length / daysInRange : null
  const lastEntry = entries.length ? entries.reduce((a, b) => new Date(b.timestamp).getTime() > new Date(a.timestamp).getTime() ? b : a) : null
  const lastTradeTs = lastEntry ? new Date(lastEntry.timestamp).getTime() : null
  const lastTradeStr = lastEntry ? (() => { const d = new Date(lastEntry.timestamp); const ago = Math.round((now - d.getTime()) / (86400 * 1000)); return ago === 0 ? 'Today' : ago === 1 ? '1d ago' : ago < 30 ? ago + 'd ago' : d.toLocaleDateString() })() : '–'
  return { profitFactor, expectancy, maxWin, maxLoss, sortino, tradesPerDay, lastTradeStr, lastTradeTs }
}

async function updateAnalysisPanel (strategies) {
  const tbody = document.getElementById('analysis-tbody')
  if (!tbody) return
  analysisTimeRange = document.getElementById('analysis-time-range')?.value || 'sinceReset'
  try {
    const res = await fetch('/api/trades?limit=500')
    if (res.ok) {
      const data = await res.json()
      const list = Array.isArray(data.trades) ? data.trades : []
      const byStrategy = {}
      const now = Date.now()
      const range = analysisTimeRange
      list.forEach(t => {
        const id = t.strategyId || '_unknown_'
        let include = true
        if (range === 'last7d') include = (now - t.timestamp) <= 7 * 24 * 60 * 60 * 1000
        else if (range === 'last30d') include = (now - t.timestamp) <= 30 * 24 * 60 * 60 * 1000
        else if (range === 'sinceReset') {
          const strat = (strategies || []).find(s => s.id === id)
          const resetAt = strat?.pnlResetAt ? new Date(strat.pnlResetAt).getTime() : 0
          include = t.timestamp >= resetAt
        }
        if (!include) return
        if (!byStrategy[id]) byStrategy[id] = { count: 0, fee: 0 }
        byStrategy[id].count += 1
        if (t.fee && (t.fee.currency === 'USDT' || t.fee.currency === 'BNB')) byStrategy[id].fee += Number(t.fee.cost || 0)
      })
      analysisTradesData = byStrategy
    }
  } catch (e) { analysisTradesData = {} }

  const list = (strategies || []).map(s => {
    const m = getMetricsForRange(s)
    const hist = getFilteredHistoryForRange(s)
    const sharpe = computeSharpe(hist)
    const extra = computeExtraMetrics(hist, s)
    const td = analysisTradesData[s.id] || {}
    return { ...s, _metrics: m, _sharpe: sharpe, _tradesHistory: td.count || 0, _fees: td.fee || 0, _profitFactor: extra.profitFactor, _expectancy: extra.expectancy, _maxWin: extra.maxWin, _maxLoss: extra.maxLoss, _sortino: extra.sortino, _tradesPerDay: extra.tradesPerDay, _lastTradeStr: extra.lastTradeStr, _lastTradeTs: extra.lastTradeTs }
  })

  const sorted = [...list].sort((a, b) => {
    const sortKey = analysisSortBy === 'avgDuration' ? 'avgTradeDurationMs' : analysisSortBy
    const extraKeys = { sharpe: '_sharpe', tradesHistory: '_tradesHistory', fees: '_fees', profitFactor: '_profitFactor', expectancy: '_expectancy', maxWin: '_maxWin', maxLoss: '_maxLoss', sortino: '_sortino', tradesPerDay: '_tradesPerDay', lastTrade: '_lastTradeTs' }
    const extraKey = extraKeys[analysisSortBy]
    const va = extraKey ? (extraKey === '_lastTradeTs' ? a._lastTradeTs : a[extraKey]) : (a._metrics && a._metrics[sortKey]) != null ? a._metrics[sortKey] : a[analysisSortBy]
    const vb = extraKey ? (extraKey === '_lastTradeTs' ? b._lastTradeTs : b[extraKey]) : (b._metrics && b._metrics[sortKey]) != null ? b._metrics[sortKey] : b[analysisSortBy]
    if (analysisSortBy === 'name' || analysisSortBy === 'type') {
      const sa = (va ?? '').toString()
      const sb = (vb ?? '').toString()
      return analysisSortDesc ? sb.localeCompare(sa) : sa.localeCompare(sb)
    }
    const na = Number(va)
    const nb = Number(vb)
    if (analysisSortBy === 'winRate' || analysisSortBy === 'exposure' || analysisSortBy === 'avgDuration') {
      if (na != null && !isNaN(na) && nb != null && !isNaN(nb)) return analysisSortDesc ? na - nb : nb - na
      return ((nb != null && !isNaN(nb)) ? 1 : 0) - ((na != null && !isNaN(na)) ? 1 : 0)
    }
    if (na != null && !isNaN(na) && nb != null && !isNaN(nb)) return analysisSortDesc ? nb - na : na - nb
    return ((na != null && !isNaN(na)) ? -1 : 0) - ((nb != null && !isNaN(nb)) ? -1 : 0)
  })

  const pnlColor = (v) => (v ?? 0) >= 0 ? '#22c55e' : '#ef4444'
  const totalTradesInRange = sorted.reduce((sum, s) => sum + (s._metrics?.trades ?? 0), 0)
  const totalTradesEl = document.getElementById('analysis-total-trades')
  if (totalTradesEl) totalTradesEl.textContent = totalTradesInRange.toLocaleString()

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="23">No strategies</td></tr>'
  } else {
    tbody.innerHTML = sorted.map(s => {
      const m = s._metrics
      const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const typeTag = s.id && s.id.startsWith('short_') ? 'Short' : 'Long'
      const winRatePct = m.winRate != null ? (m.winRate * 100).toFixed(1) : '–'
      const exposurePct = m.exposure != null ? (m.exposure * 100).toFixed(1) : '–'
      const avgDur = m.avgTradeDurationMs != null ? (m.avgTradeDurationMs < 60000 ? (m.avgTradeDurationMs / 1000).toFixed(0) + 's' : (m.avgTradeDurationMs / 60000).toFixed(1) + 'm') : '–'
      const sharpeStr = s._sharpe != null ? s._sharpe.toFixed(2) : '–'
      const pfStr = s._profitFactor != null ? (s._profitFactor === Infinity ? '∞' : s._profitFactor.toFixed(2)) : '–'
      const expStr = s._expectancy != null ? formatPnl(s._expectancy).replace(' USDT', '') : '–'
      const sortinoStr = s._sortino == null ? '–' : (s._sortino === Infinity ? '∞' : (s._sortino === -Infinity ? '-∞' : s._sortino.toFixed(2)))
      const tpdStr = s._tradesPerDay != null ? s._tradesPerDay.toFixed(1) : '–'
      const regimeActiveClass = s.regimeActive ? ' class="regime-active"' : ''
      return '<tr' + regimeActiveClass + '>' +
        '<td>' + name + '</td>' +
        '<td class="numeric">' + typeTag + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.totalPnl) + '">' + formatPnl(m.totalPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.realizedPnl) + '">' + formatPnl(m.realizedPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.unrealizedPnl) + '">' + formatPnl(m.unrealizedPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric">' + (m.wins ?? 0) + '/' + (m.losses ?? 0) + '</td>' +
        '<td class="numeric">' + winRatePct + '</td>' +
        '<td class="numeric" style="color:#22c55e">' + (m.avgWin != null ? formatPnl(m.avgWin).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (m.avgLoss != null ? formatPnl(m.avgLoss).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + sharpeStr + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (m.maxDrawdown != null ? formatPnl(m.maxDrawdown).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + (m.trades ?? 0) + '</td>' +
        '<td class="numeric">' + (s._tradesHistory ?? 0) + '</td>' +
        '<td class="numeric">' + (s._fees != null ? s._fees.toFixed(4) : '–') + '</td>' +
        '<td class="numeric">' + exposurePct + '</td>' +
        '<td class="numeric">' + avgDur + '</td>' +
        '<td class="numeric">' + pfStr + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(s._expectancy) + '">' + expStr + '</td>' +
        '<td class="numeric" style="color:#22c55e">' + (s._maxWin != null ? formatPnl(s._maxWin).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (s._maxLoss != null ? formatPnl(s._maxLoss).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + sortinoStr + '</td>' +
        '<td class="numeric">' + tpdStr + '</td>' +
        '<td class="numeric">' + (s._lastTradeStr || '–') + '</td></tr>'
    }).join('')
  }

  const topBottomEl = document.getElementById('analysis-top-bottom')
  if (topBottomEl && sorted.length > 0) {
    const byPnl = [...sorted].sort((a, b) => (b._metrics.totalPnl ?? 0) - (a._metrics.totalPnl ?? 0))
    const top3 = byPnl.slice(0, 3)
    const bottom3 = byPnl.slice(-3).reverse()
    topBottomEl.innerHTML =
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Top 3</span><ul style="margin:0;padding-left:1.25rem;color:#22c55e">' +
      top3.map(s => '<li>' + (s.name || s.id) + ': ' + formatPnl(s._metrics.totalPnl).replace(' USDT', '') + '</li>').join('') + '</ul></div>' +
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Bottom 3</span><ul style="margin:0;padding-left:1.25rem;color:#ef4444">' +
      bottom3.map(s => '<li>' + (s.name || s.id) + ': ' + formatPnl(s._metrics.totalPnl).replace(' USDT', '') + '</li>').join('') + '</ul></div>'
  }

  const labels = sorted.map(s => s.name || s.id)
  const pnlValues = sorted.map(s => s._metrics.totalPnl ?? 0)
  const winRateValues = sorted.map(s => s._metrics.winRate != null ? s._metrics.winRate * 100 : null)
  const barColorsPnl = pnlValues.map(v => (v >= 0 ? 'rgba(74, 222, 128, 0.8)' : 'rgba(248, 113, 113, 0.8)'))
  const barColorsWr = winRateValues.map(() => 'rgba(56, 189, 248, 0.7)')
  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { display: false } }
    }
  }
  const pnlCtx = document.getElementById('analysis-pnl-chart')?.getContext('2d')
  if (pnlCtx) {
    const pnlData = { labels, datasets: [{ label: 'Total PnL', data: pnlValues, backgroundColor: barColorsPnl }] }
    if (analysisPnlChart) {
      analysisPnlChart.data = pnlData
      analysisPnlChart.update()
    } else {
      analysisPnlChart = new Chart(pnlCtx, { type: 'bar', data: pnlData, options: chartOpts })
    }
  }
  const wrCtx = document.getElementById('analysis-winrate-chart')?.getContext('2d')
  if (wrCtx) {
    const wrData = { labels, datasets: [{ label: 'Win rate %', data: winRateValues, backgroundColor: barColorsWr }] }
    const wrOpts = { ...chartOpts, scales: { ...chartOpts.scales, x: { ...chartOpts.scales.x, min: 0, max: 100 } } }
    if (analysisWinrateChart) {
      analysisWinrateChart.data = wrData
      analysisWinrateChart.options = wrOpts
      analysisWinrateChart.update()
    } else {
      analysisWinrateChart = new Chart(wrCtx, { type: 'bar', data: wrData, options: wrOpts })
    }
  }

  const equitySelect = document.getElementById('analysis-equity-strategy')
  const equityCtx = document.getElementById('analysis-equity-chart')?.getContext('2d')
  const savedEquityStrategyId = equitySelect?.value || null
  if (equitySelect) {
    const opts = (strategies || []).map(s => '<option value="' + s.id + '">' + (s.name || s.id) + '</option>').join('')
    equitySelect.innerHTML = opts || '<option value="">—</option>'
    if (savedEquityStrategyId && (strategies || []).some(s => s.id === savedEquityStrategyId)) {
      equitySelect.value = savedEquityStrategyId
    }
  }
  if (equityCtx) {
    const selectedId = equitySelect?.value || (strategies && strategies[0]?.id)
    const sel = (strategies || []).find(s => s.id === selectedId)
    const history = sel ? getFilteredHistoryForRange(sel) : []
    let cum = 0
    const equityLabels = history.map(e => new Date(e.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    const equityData = history.map(e => { cum += Number(e.pnl ?? 0); return cum })
    const eqData = { labels: equityLabels, datasets: [{ label: 'Cumulative PnL', data: equityData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.2 }] }
    const eqOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } }
      }
    }
    if (analysisEquityChart) {
      analysisEquityChart.data = eqData
      analysisEquityChart.update()
    } else {
      analysisEquityChart = new Chart(equityCtx, { type: 'line', data: eqData, options: eqOpts })
    }
  }
}

async function refreshStatus() {
  try {
    const data = await fetchStatus()
    document.getElementById('raw-json').textContent = JSON.stringify(data, null, 2)

    const bot = data.bot || {}
    document.getElementById('bot-symbol').textContent = bot.symbol || '-'
    document.getElementById('bot-timeframe').textContent = bot.timeframe || '-'
    const modeEl = document.getElementById('bot-mode')
    if (modeEl) {
      modeEl.textContent = bot.mode?.testnet ? 'TESTNET' : 'LIVE'
      modeEl.className = 'status-pill ' + (bot.mode?.testnet ? 'pill-warn' : 'pill-ok')
    }
    const autoEl = document.getElementById('bot-auto')
    if (autoEl) {
      const on = data.config?.autoTradingEnabled !== false
      autoEl.textContent = on ? 'ON' : 'OFF'
      autoEl.className = 'status-pill ' + (on ? 'pill-ok' : 'pill-warn')
    }

    const strategies = data.strategies || []
    latestStrategies = strategies
    updatePositionActivity(strategies, data.market || {})

    const tbody = document.getElementById('strategies-tbody')
    const detailPane = document.getElementById('strategy-detail-pane')
    if (tbody) {
      if (strategies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No strategies</td></tr>'
      } else {
        const sorted = [...strategies].sort((a, b) => {
          const aShort = a.id && a.id.startsWith('short_')
          const bShort = b.id && b.id.startsWith('short_')
          if (aShort !== bShort) return aShort ? 1 : -1
          return (a.name || a.id).localeCompare(b.name || b.id)
        })
        tbody.innerHTML = sorted.map(s => {
          const posText = s.position?.open ? s.position.side + ' ' + formatAmount(s.position.amount) : 'Flat'
          const runningPill = s.running ? 'Running' : 'Stopped'
          const hasPosition = s.position?.open === true
          const isShort = s.id && s.id.startsWith('short_')
          const isManual = s.id === 'manual'
          const startStopBtn = s.id === 'manual' ? '' : '<button class="secondary strategy-btn" data-id="' + s.id + '" data-running="' + s.running + '">' + (s.running ? 'Stop' : 'Start') + '</button> '
          const buyBtn = isShort ? '' : '<button class="primary strategy-buy-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Long</button> '
          const shortBtn = isShort ? '<button class="primary strategy-short-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Short</button> ' : ''
          const sellBtn = '<button class="danger strategy-sell-btn" data-id="' + s.id + '"' + (!hasPosition ? ' disabled' : '') + '>Close</button> '
          const resetBtn = '<button class="secondary strategy-reset-pnl-btn" data-id="' + s.id + '">Reset stats & trades</button>'
          const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
          const typeTag = isManual ? 'Utility' : isShort ? 'Short' : 'Long'
          const selected = s.id === selectedStrategyId ? ' selected' : ''
          const regimeActive = s.regimeActive ? ' regime-active' : ''
          return '<tr class="clickable' + selected + regimeActive + '" data-strategy-id="' + s.id + '">' +
            '<td>' + name + '</td>' +
            '<td>' + typeTag + '</td>' +
            '<td>' + runningPill + '</td>' +
            '<td>' + posText + '</td>' +
            '<td>' + (s.lastDecision || '–') + '</td>' +
            '<td>' + startStopBtn + buyBtn + shortBtn + sellBtn + resetBtn + '</td></tr>'
        }).join('')
        tbody.querySelectorAll('tr[data-strategy-id]').forEach(tr => {
          tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return
            const id = tr.dataset.strategyId || null
            selectedStrategyId = id
            tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'))
            tr.classList.add('selected')
            const strat = strategies.find(x => x.id === id)
            if (detailPane) {
              detailPane.classList.remove('empty')
              detailPane.innerHTML = strat ? strategyDetailHtml(strat) : 'Click a strategy row.'
              if (!strat) detailPane.classList.add('empty')
            }
            try {
              if (selectedStrategyId) localStorage.setItem('selectedStrategyId', selectedStrategyId)
              else localStorage.removeItem('selectedStrategyId')
              localStorage.removeItem('customWindowStart')
              localStorage.removeItem('customWindowEnd')
            } catch (err) { console.error(err) }
            customWindow = null
            updateChartFocusLabel()
            if (lastCandles.length) renderChart(lastCandles)
            else fetchCandles().then(renderChart).catch(console.error)
          })
        })
        const selectedStrat = strategies.find(s => s.id === selectedStrategyId)
        if (detailPane) {
          if (selectedStrat) {
            detailPane.classList.remove('empty')
            detailPane.innerHTML = strategyDetailHtml(selectedStrat)
          } else {
            detailPane.classList.add('empty')
            detailPane.innerHTML = 'Click a strategy row to see details.'
          }
        }
      }
    }

    const balances = data.portfolio?.balances || {}
    const btc = balances.BTC || {}
    const usdt = balances.USDT || {}
    document.getElementById('btc-line').textContent =
      'total ' + formatAmount(btc.total) + ' · free ' + formatAmount(btc.free) + ' · used ' + formatAmount(btc.used)
    document.getElementById('usdt-line').textContent =
      'total ' + formatQuote(usdt.total) + ' · free ' + formatQuote(usdt.free) + ' · used ' + formatQuote(usdt.used)

    const strategiesForPos = data.strategies || []
    const withPosition = strategiesForPos.filter(s => s.position?.open)
    const posContentEl = document.getElementById('position-content')
    const closeAllBtn = document.getElementById('close-all-positions-btn')
    if (closeAllBtn) closeAllBtn.disabled = withPosition.length === 0
    const topCloseAllBtn = document.getElementById('top-close-all-btn')
    if (topCloseAllBtn) topCloseAllBtn.disabled = withPosition.length === 0
    if (withPosition.length === 0) {
      posContentEl.innerHTML =
        '<div class="row"><span class="label">Status</span><span class="value">No open positions</span></div>'
    } else {
      let totalAmount = 0
      const rows = withPosition.map(s => {
        const amt = s.position?.amount ?? 0
        totalAmount += amt
        const name = (s.name || s.id)
        return '<div class="row"><span class="label">' + name + '</span><span class="value">' +
          (s.position.side || 'long') + ' ' + formatAmount(amt) + ' @ ' + formatPrice(s.position.entryPrice) + '</span></div>'
      }).join('')
      const totalRow = withPosition.length > 1
        ? '<div class="row" style="margin-top: 0.35rem; padding-top: 0.35rem; border-top: 1px solid #1f2937;"><span class="label">Total</span><span class="value">long ' + formatAmount(totalAmount) + ' BTC</span></div>'
        : ''
      posContentEl.innerHTML = rows + totalRow
    }

    // Populate config inputs only when user isn't editing them (avoids overwriting while typing)
    const configInputIds = ['risk-input', 'sl-input', 'tp-input']
    const anyConfigFocused = configInputIds.some(id => document.getElementById(id) === document.activeElement)
    if (!anyConfigFocused) {
      const envCfg = data.config?.env || {}
      const rtCfg = data.config?.runtime || {}
      document.getElementById('risk-input').value =
        rtCfg.riskPerTrade != null ? rtCfg.riskPerTrade : envCfg.riskPerTrade ?? ''
      document.getElementById('sl-input').value =
        rtCfg.stopLossPct != null ? rtCfg.stopLossPct : envCfg.stopLossPct ?? ''
      document.getElementById('tp-input').value =
        rtCfg.takeProfitPct != null ? rtCfg.takeProfitPct : envCfg.takeProfitPct ?? ''
    }
    const regimeCb = document.getElementById('regime-awareness-cb')
    if (regimeCb) regimeCb.checked = data.config?.regimeFilterEnabled !== false

    const budget = data.config?.budget || {}
    const budgetGlobalEl = document.getElementById('budget-global')
    const budgetPerEl = document.getElementById('budget-per-strategy')
    if (budgetGlobalEl) {
      budgetGlobalEl.textContent = (budget.globalBudgetQuote != null && budget.globalBudgetQuote > 0)
        ? formatQuote(budget.globalBudgetQuote) + ' USDT'
        : 'Full portfolio'
    }
    if (budgetPerEl) {
      budgetPerEl.textContent = (budget.strategyBudgetQuote != null && budget.strategyBudgetQuote > 0)
        ? formatQuote(budget.strategyBudgetQuote) + ' USDT'
        : 'Full portfolio'
    }

    const market = data.market || {}
    document.getElementById('chart-close').textContent = formatPrice(market.lastPrice)
    document.getElementById('chart-ema9').textContent = formatPrice(market.ema9)
    document.getElementById('chart-ema20').textContent = formatPrice(market.ema20)
    const ema21El = document.getElementById('chart-ema21')
    if (ema21El) ema21El.textContent = formatPrice(market.ema21)
    document.getElementById('chart-ema50').textContent = formatPrice(market.ema50)
    document.getElementById('chart-ema200').textContent = formatPrice(market.ema200)

    const regime = market.regime || {}
    const sourceEl = document.getElementById('regime-source')
    if (sourceEl) sourceEl.textContent = (regime.timeframe && regime.candles) ? regime.timeframe + ', ' + regime.candles + ' bars' : '–'
    const volEl = document.getElementById('regime-volatility')
    if (volEl) {
      const v = regime.volatility
      const ratio = regime.volatilityRatio
      volEl.textContent = v ? (v.charAt(0).toUpperCase() + v.slice(1)) + (ratio != null ? ' (' + ratio + '×)' : '') : '–'
    }
    const trendEl = document.getElementById('regime-trend')
    if (trendEl) {
      const t = regime.trend
      const adx = regime.adx
      trendEl.textContent = t ? (t.charAt(0).toUpperCase() + t.slice(1)) + (adx != null ? ' (ADX ' + adx + ')' : '') : '–'
    }
    const dirEl = document.getElementById('regime-direction')
    if (dirEl) {
      const d = regime.trendDirection
      dirEl.textContent = d ? (d.charAt(0).toUpperCase() + d.slice(1)) : '–'
    }

    // Profit card: use aggregate pnl from API, or sum from strategies if pnl block missing
    const strategiesForPnl = data.strategies || []
    const aggregateRealized = data.pnl?.realized ?? strategiesForPnl.reduce((a, s) => a + (Number(s.realizedPnl) || 0), 0)
    const aggregateUnrealized = data.pnl?.unrealized ?? strategiesForPnl.reduce((a, s) => a + (Number(s.unrealizedPnl) || 0), 0)
    const aggregateTotal = data.pnl?.total ?? (aggregateRealized + aggregateUnrealized)
    document.getElementById('pnl-realized').textContent = formatPnl(aggregateRealized)
    document.getElementById('pnl-realized').style.color = (aggregateRealized ?? 0) >= 0 ? '#22c55e' : '#ef4444'
    document.getElementById('pnl-unrealized').textContent = formatPnl(aggregateUnrealized)
    document.getElementById('pnl-unrealized').style.color = (aggregateUnrealized ?? 0) >= 0 ? '#22c55e' : '#ef4444'
    document.getElementById('pnl-total').textContent = formatPnl(aggregateTotal)
    document.getElementById('pnl-total').style.color = (aggregateTotal ?? 0) >= 0 ? '#22c55e' : '#ef4444'

    updateChartFocusLabel()

    await updateAnalysisPanel(strategies)
  } catch (err) {
    document.getElementById('action-status').textContent = 'Error: ' + err.message
  }
}

async function refreshChart() {
  try {
    const candles = await fetchCandles()
    // Keep existing zoom (customWindow) so the view doesn't jump when a new candle arrives
    renderChart(candles)
  } catch (err) {
    // Chart errors shouldn't spam the UI; log to console instead.
    console.error(err)
  }
}

async function refreshFees() {
  try {
    const res = await fetch('/api/trades?limit=50')
    if (!res.ok) return
    const data = await res.json()
    const el = document.getElementById('fees-total')
    if (data.totalFeeEstimate != null) {
      el.textContent = (data.feeCurrency || 'USDT') + ' ' +
        Number(data.totalFeeEstimate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    } else {
      el.textContent = '–'
    }
    const tbody = document.getElementById('trades-tbody')
    latestTrades = Array.isArray(data.trades) ? data.trades : []
    const raw = latestTrades.slice(0, 50)
    // Group by orderId; one row per order
    const byOrder = new Map()
    raw.forEach((t, idx) => {
      const id = t.orderId != null ? String(t.orderId) : '__single__' + idx
      if (!byOrder.has(id)) byOrder.set(id, [])
      byOrder.get(id).push(t)
    })
    const groups = Array.from(byOrder.entries())
      .map(([id, list]) => ({ orderId: list[0].orderId, trades: list }))
      .sort((a, b) => (b.trades[0].timestamp || 0) - (a.trades[0].timestamp || 0))
      .slice(0, 15)
    function formatDetail(detail) {
      if (!detail || typeof detail !== 'object') return '–'
      const parts = []
      for (const [k, v] of Object.entries(detail)) {
        if (v == null) continue
        const num = Number(v)
        const val = Number.isFinite(num)
          ? (Math.abs(num) >= 1 ? num.toLocaleString(undefined, { maximumFractionDigits: 2 }) : num.toFixed(4))
          : String(v)
        parts.push(k + ': ' + val)
      }
      return parts.length ? parts.join(', ') : '–'
    }
    if (groups.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10">No trades</td></tr>'
    } else {
      tbody.innerHTML = groups.map((grp, grpIdx) => {
        const trades = grp.trades
        const t0 = trades[0]
        const n = trades.length
        const timeStr = n === 1
          ? (t0.timestamp ? new Date(t0.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '–')
          : (t0.timestamp && trades[n - 1].timestamp
            ? new Date(t0.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) + ' … ' + new Date(trades[n - 1].timestamp).toLocaleString(undefined, { timeStyle: 'short' })
            : '–')
        const orderIdStr = grp.orderId != null ? String(grp.orderId) : '–'
        const sideClass = t0.side === 'buy' ? 'side-buy' : 'side-sell'
        const strategyStr = t0.strategyName || t0.strategyId || '–'
        const reasonStr = t0.reason || '–'
        const detailStr = n === 1 ? formatDetail(t0.detail) : (n + ' fills')
        const totalAmount = trades.reduce((s, t) => s + (Number(t.amount) || 0), 0)
        const totalCost = trades.reduce((s, t) => s + (Number(t.cost) || 0), 0)
        const totalFee = trades.reduce((s, t) => s + (Number(t.fee?.cost) || 0), 0)
        const avgPrice = totalAmount ? totalCost / totalAmount : (t0.price != null ? t0.price : null)
        const costStr = totalCost ? formatQuote(totalCost) : '–'
        const feeStr = totalFee ? Number(totalFee).toFixed(4) + ' ' + (t0.fee?.currency || 'USDT') : '–'
        return '<tr data-group-index="' + grpIdx + '">' +
          '<td>' + timeStr + '</td>' +
          '<td class="order-id-cell">' + orderIdStr + '</td>' +
          '<td class="' + sideClass + '">' + (t0.side || '–') + (n > 1 ? ' <span class="fill-badge">' + n + '</span>' : '') + '</td>' +
          '<td>' + strategyStr + '</td>' +
          '<td>' + reasonStr + '</td>' +
          '<td class="detail-cell" title="' + (n === 1 ? formatDetail(t0.detail).replace(/"/g, '&quot;') : '') + '">' + detailStr + '</td>' +
          '<td>' + formatAmount(totalAmount) + '</td>' +
          '<td>' + formatPrice(avgPrice) + '</td>' +
          '<td>' + costStr + '</td>' +
          '<td>' + feeStr + '</td></tr>'
      }).join('')

      // Click a row to zoom chart around first fill and select strategy
      Array.from(tbody.querySelectorAll('tr[data-group-index]')).forEach((row) => {
        const idx = parseInt(row.getAttribute('data-group-index'), 10)
        const grp = groups[idx]
        if (!grp || !grp.trades.length) return
        const t0 = grp.trades[0]
        row.addEventListener('click', () => {
          if (t0.strategyId) {
            selectedStrategyId = t0.strategyId
            const tbody = document.getElementById('strategies-tbody')
            const detailPane = document.getElementById('strategy-detail-pane')
            if (tbody) {
              tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'))
              const row = tbody.querySelector('tr[data-strategy-id="' + t0.strategyId + '"]')
              if (row) row.classList.add('selected')
            }
            if (detailPane && latestStrategies.length) {
              const strat = latestStrategies.find(s => s.id === t0.strategyId)
              if (strat) {
                detailPane.classList.remove('empty')
                detailPane.innerHTML = strategyDetailHtml(strat)
              }
            }
            const strategiesTab = document.querySelector('.tab[data-tab="strategies"]')
            if (strategiesTab) strategiesTab.click()
          }
          updateChartFocusLabel()
          if (!lastCandles.length) return
          const ts = t0.timestamp
          if (!ts) return
          const src = lastCandles
          let idxC = src.findIndex(c => c.timestamp >= ts)
          if (idxC === -1) idxC = src.length - 1
          const half = 20
          let start = Math.max(0, idxC - half)
          let end = Math.min(src.length, idxC + half + 1)
          customWindow = { start, end }
          try {
            localStorage.setItem('customWindowStart', String(start))
            localStorage.setItem('customWindowEnd', String(end))
            if (selectedStrategyId) localStorage.setItem('selectedStrategyId', selectedStrategyId)
          } catch (err) { console.error(err) }
          renderChart(lastCandles)
        })
      })
    }
  } catch (err) {
    document.getElementById('fees-total').textContent = 'Error'
    document.getElementById('trades-tbody').innerHTML = '<tr><td colspan="10">Error loading trades</td></tr>'
  }
}

document.getElementById('buy-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  const amountRaw = document.getElementById('manual-amount').value
  const unit = document.getElementById('manual-unit').value
  const amount = parseFloat(amountRaw)
  const body = (typeof amount === 'number' && amount > 0 && unit) ? { amount, unit } : {}
  statusEl.textContent = body.amount ? `Buying ${amount} ${unit === 'quote' ? 'USDT' : 'BTC'}…` : 'Opening full position (BUY)...'
  try {
    const res = await fetch('/api/manual-buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      statusEl.textContent = data.error || 'Buy failed'
      return
    }
    statusEl.textContent = data.order ? `Buy order placed (${data.order.id}).` : 'Position opened.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Buy failed: ' + err.message
  }
})

document.getElementById('sell-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  const amountRaw = document.getElementById('manual-amount').value
  const unit = document.getElementById('manual-unit').value
  const amount = parseFloat(amountRaw)
  const body = (typeof amount === 'number' && amount > 0 && unit) ? { amount, unit } : {}
  statusEl.textContent = body.amount ? `Selling ${amount} ${unit === 'quote' ? 'USDT' : 'BTC'}…` : 'Closing full position (SELL)...'
  try {
    const res = await fetch('/api/manual-sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      statusEl.textContent = data.error || 'Sell failed'
      return
    }
    statusEl.textContent = data.order ? `Sell order placed (${data.order.id}).` : 'Position closed.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Sell failed: ' + err.message
  }
})

document.getElementById('apply-config-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  const risk = parseFloat(document.getElementById('risk-input').value)
  const sl = parseFloat(document.getElementById('sl-input').value)
  const tp = parseFloat(document.getElementById('tp-input').value)
  statusEl.textContent = 'Updating config...'
  try {
    await postJson('/api/config', {
      riskPerTrade: isNaN(risk) ? undefined : risk,
      stopLossPct: isNaN(sl) ? undefined : sl,
      takeProfitPct: isNaN(tp) ? undefined : tp
    })
    statusEl.textContent = 'Config updated.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Config update failed: ' + err.message
  }
})

document.getElementById('reset-config-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Resetting risk config to .env defaults...'
  try {
    const res = await fetch('/api/config/reset', { method: 'POST' })
    if (!res.ok) {
      statusEl.textContent = 'Reset failed'
      return
    }
    statusEl.textContent = 'Risk config reset to .env defaults.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Reset failed: ' + err.message
  }
})

async function resetAllPnl () {
  const statusEl = document.getElementById('action-status')
  if (!confirm('Reset stats and trade history for all strategies?')) return
  statusEl.textContent = 'Resetting stats and trades…'
  try {
    const res = await fetch('/api/reset-all-pnl', { method: 'POST' })
    if (!res.ok) {
      statusEl.textContent = 'Reset failed'
      return
    }
    statusEl.textContent = 'Stats and trades reset.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Reset failed: ' + err.message
  }
}
document.getElementById('reset-all-pnl-btn').addEventListener('click', resetAllPnl)
document.getElementById('top-reset-pnl-btn').addEventListener('click', resetAllPnl)

async function toggleAutoTrading () {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Toggling auto trading...'
  try {
    const current = document.getElementById('bot-auto').textContent.includes('ON')
    await postJson('/api/config', { autoTradingEnabled: !current })
    statusEl.textContent = 'Auto trading toggled.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Toggle failed: ' + err.message
  }
}
document.getElementById('toggle-auto-btn').addEventListener('click', toggleAutoTrading)
document.getElementById('bot-auto').addEventListener('click', toggleAutoTrading)

document.getElementById('regime-awareness-cb').addEventListener('change', async () => {
  const statusEl = document.getElementById('action-status')
  const cb = document.getElementById('regime-awareness-cb')
  statusEl.textContent = 'Updating regime filter...'
  try {
    await postJson('/api/config/regime-filter', { enabled: cb.checked })
    statusEl.textContent = cb.checked ? 'Regime awareness on.' : 'Regime awareness off (entries not filtered by regime).'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Update failed: ' + err.message
    cb.checked = !cb.checked
  }
})

const chartWindowSelect = document.getElementById('chart-window-select')
if (chartWindowSelect) {
  if (chartWindowSize === 'all') {
    chartWindowSelect.value = 'all'
  } else {
    chartWindowSelect.value = String(chartWindowSize)
  }
  chartWindowSelect.addEventListener('change', async (e) => {
    const val = e.target.value
    chartWindowSize = val === 'all' ? 'all' : Number(val)
    customWindow = null
    try {
      localStorage.setItem('chartWindowSize', val)
      localStorage.removeItem('customWindowStart')
      localStorage.removeItem('customWindowEnd')
    } catch (err) {
      console.error(err)
    }
    try {
      if (!lastCandles.length) {
        lastCandles = await fetchCandles()
      }
      renderChart(lastCandles)
    } catch (err) {
      console.error(err)
    }
  })
}

const chartResetBtn = document.getElementById('chart-reset-btn')
if (chartResetBtn) {
  chartResetBtn.addEventListener('click', async () => {
    customWindow = null
    try {
      localStorage.removeItem('customWindowStart')
      localStorage.removeItem('customWindowEnd')
    } catch (err) {
      console.error(err)
    }
    try {
      if (!lastCandles.length) {
        lastCandles = await fetchCandles()
      }
      renderChart(lastCandles)
    } catch (err) {
      console.error(err)
    }
  })
}

refreshStatus()
refreshChart()
refreshFees()
setInterval(refreshStatus, 5000)   // UI / status every 5s
setInterval(refreshChart, 20000)  // chart every 20s
setInterval(refreshFees, 20000)   // fees every 20s

const rawJsonEl = document.getElementById('raw-json')
const rawJsonToggle = document.getElementById('toggle-raw-json')
if (rawJsonEl && rawJsonToggle) {
  let rawVisible = false
  rawJsonToggle.addEventListener('click', () => {
    rawVisible = !rawVisible
    rawJsonEl.style.display = rawVisible ? 'block' : 'none'
    rawJsonToggle.textContent = rawVisible ? 'Hide' : 'Show'
  })
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.getAttribute('data-tab')
    if (!tabId) return
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    const panel = document.getElementById('panel-' + tabId)
    if (panel) panel.classList.add('active')
  })
})

document.querySelectorAll('.analysis-table .sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.getAttribute('data-sort')
    if (!key) return
    if (analysisSortBy === key) analysisSortDesc = !analysisSortDesc
    else { analysisSortBy = key; analysisSortDesc = key === 'name' || key === 'type' ? false : true }
    document.querySelectorAll('.analysis-table .sortable').forEach(h => {
      h.classList.remove('sorted-asc', 'sorted-desc')
      if (h.getAttribute('data-sort') === analysisSortBy) h.classList.add(analysisSortDesc ? 'sorted-desc' : 'sorted-asc')
    })
    updateAnalysisPanel(latestStrategies)
  })
})

const analysisTimeRangeEl = document.getElementById('analysis-time-range')
if (analysisTimeRangeEl) {
  analysisTimeRangeEl.addEventListener('change', () => { updateAnalysisPanel(latestStrategies) })
}
const analysisEquityStrategyEl = document.getElementById('analysis-equity-strategy')
if (analysisEquityStrategyEl) {
  analysisEquityStrategyEl.addEventListener('change', () => { updateAnalysisPanel(latestStrategies) })
}

const activityGoto = document.getElementById('activity-goto-trades')
if (activityGoto) {
  activityGoto.addEventListener('click', (e) => {
    e.preventDefault()
    const tab = document.querySelector('.tab[data-tab="trades"]')
    if (tab) tab.click()
  })
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.strategy-btn')
  if (btn) {
    e.preventDefault()
    const id = btn.dataset.id
    const running = btn.dataset.running === 'true'
    const action = running ? 'stop' : 'start'
    fetch('/api/strategies/' + id + '/' + action, { method: 'POST' }).then(() => refreshStatus()).catch(() => { document.getElementById('action-status').textContent = 'Failed to ' + action })
    return
  }
  const buyBtn = e.target.closest('.strategy-buy-btn')
  if (buyBtn && !buyBtn.disabled) {
    e.preventDefault()
    const id = buyBtn.dataset.id
    document.getElementById('action-status').textContent = 'Opening long for ' + id + '…'
    fetch('/api/strategies/' + id + '/buy', { method: 'POST' })
      .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) document.getElementById('action-status').textContent = data.error || 'Buy failed'
        else { document.getElementById('action-status').textContent = 'Position opened.'; refreshStatus() }
      })
      .catch(err => { document.getElementById('action-status').textContent = 'Buy failed: ' + err.message })
    return
  }
  const shortBtn = e.target.closest('.strategy-short-btn')
  if (shortBtn && !shortBtn.disabled) {
    e.preventDefault()
    const id = shortBtn.dataset.id
    document.getElementById('action-status').textContent = 'Opening short for ' + id + '…'
    fetch('/api/strategies/' + id + '/short', { method: 'POST' })
      .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) document.getElementById('action-status').textContent = data.error || 'Short failed'
        else { document.getElementById('action-status').textContent = 'Short position opened.'; refreshStatus() }
      })
      .catch(err => { document.getElementById('action-status').textContent = 'Short failed: ' + err.message })
    return
  }
  const sellBtn = e.target.closest('.strategy-sell-btn')
  if (sellBtn && !sellBtn.disabled) {
    e.preventDefault()
    const id = sellBtn.dataset.id
    document.getElementById('action-status').textContent = 'Closing position for ' + id + '…'
    fetch('/api/strategies/' + id + '/sell', { method: 'POST' })
      .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) document.getElementById('action-status').textContent = data.error || 'Sell failed'
        else { document.getElementById('action-status').textContent = 'Position closed.'; refreshStatus() }
      })
      .catch(err => { document.getElementById('action-status').textContent = 'Sell failed: ' + err.message })
    return
  }
  const closeAllBtnClick = e.target.closest('#close-all-positions-btn') || e.target.closest('#top-close-all-btn')
  if (closeAllBtnClick && !closeAllBtnClick.disabled) {
    e.preventDefault()
    document.getElementById('action-status').textContent = 'Closing all positions…'
    document.getElementById('close-all-positions-btn').disabled = true
    const topBtn = document.getElementById('top-close-all-btn')
    if (topBtn) topBtn.disabled = true
    fetch('/api/close-all', { method: 'POST' })
      .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) document.getElementById('action-status').textContent = data.error || 'Close all failed'
        else { document.getElementById('action-status').textContent = (data.closed ?? 0) + ' position(s) closed.'; refreshStatus() }
      })
      .catch(err => {
        document.getElementById('action-status').textContent = 'Close all failed: ' + err.message
        document.getElementById('close-all-positions-btn').disabled = false
        const tb = document.getElementById('top-close-all-btn')
        if (tb) tb.disabled = false
      })
    return
  }
  const resetBtn = e.target.closest('.strategy-reset-pnl-btn')
  if (resetBtn) {
    e.preventDefault()
    const id = resetBtn.dataset.id
    fetch('/api/strategies/' + id + '/reset-pnl', { method: 'POST' })
      .then(res => { if (!res.ok) throw new Error(); document.getElementById('action-status').textContent = 'Stats and trades reset for ' + id + '.'; return refreshStatus() })
      .catch(() => { document.getElementById('action-status').textContent = 'Reset failed' })
  }
})
