import { formatPrice, formatAmount, formatQuote, formatPnl } from './utils.js'
import { fetchStatus, postJson } from './api.js'
import { state } from './state.js'
import { updateChartFocusLabel, strategyDetailHtml, updateStrategiesPanel } from './strategies.js'
import { updateAnalysisPanel } from './analysis.js'
import { fetchCandles, renderChart } from './charts.js'
import { updatePositionActivity, addActivityEvent, updateTradesPanel, refreshActivityListDisplay } from './trades.js'

let audioCtx = null
function playNotificationSound () {
  try {
    const AudioContextCls = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCls) return
    if (!audioCtx) audioCtx = new AudioContextCls()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
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
  } catch (e) { console.error('Notification sound error', e) }
}

function showToast (message, level = 'info') {
  const container = document.getElementById('toast-container')
  if (!container) return
  const div = document.createElement('div')
  div.className = 'toast toast-' + (level === 'success' || level === 'error' ? level : 'info')
  div.textContent = message
  container.appendChild(div)
  requestAnimationFrame(() => {
    div.classList.add('toast-show')
    playNotificationSound()
  })
  setTimeout(() => {
    div.classList.remove('toast-show')
    setTimeout(() => { if (div.parentNode === container) container.removeChild(div) }, 200)
  }, 3500)
}

// Restore persisted chart / selection state
try {
  const savedWindow = localStorage.getItem('chartWindowSize')
  if (savedWindow) state.chartWindowSize = savedWindow === 'all' ? 'all' : Number(savedWindow)
  const savedSelected = localStorage.getItem('selectedStrategyId')
  if (savedSelected) state.selectedStrategyId = savedSelected
  const savedStart = localStorage.getItem('customWindowStart')
  const savedEnd = localStorage.getItem('customWindowEnd')
  if (savedStart != null && savedEnd != null) {
    const s = Number(savedStart)
    const e = Number(savedEnd)
    if (!isNaN(s) && !isNaN(e) && e > s) state.customWindow = { start: s, end: e }
  }
} catch (e) { console.error('Failed to restore chart state', e) }

async function refreshStatus () {
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
    const openPositionsCount = strategies.filter(s => s.position?.open).length
    const positionsEl = document.getElementById('bot-positions')
    if (positionsEl) positionsEl.textContent = openPositionsCount + ' / ' + strategies.length

    state.latestStrategies = strategies
    updatePositionActivity(strategies, data.market || {}, showToast)
    refreshActivityListDisplay()

    const balances = data.portfolio?.balances || {}
    const btc = balances.BTC || {}
    const usdt = balances.USDT || {}
    document.getElementById('btc-line').textContent =
      'total ' + formatAmount(btc.total) + ' · free ' + formatAmount(btc.free) + ' · used ' + formatAmount(btc.used)
    document.getElementById('usdt-line').textContent =
      'total ' + formatQuote(usdt.total) + ' · free ' + formatQuote(usdt.free) + ' · used ' + formatQuote(usdt.used)

    updateStrategiesPanel(strategies, {
      onStrategySelect (id, strategyList) {
        state.selectedStrategyId = id
        const detailPane = document.getElementById('strategy-detail-pane')
        const strat = strategyList.find(x => x.id === id)
        if (detailPane) {
          detailPane.classList.remove('empty')
          detailPane.innerHTML = strat ? strategyDetailHtml(strat) : 'Click a strategy row.'
          if (!strat) detailPane.classList.add('empty')
        }
        try {
          if (state.selectedStrategyId) localStorage.setItem('selectedStrategyId', state.selectedStrategyId)
          else localStorage.removeItem('selectedStrategyId')
          localStorage.removeItem('customWindowStart')
          localStorage.removeItem('customWindowEnd')
        } catch (err) { console.error(err) }
        state.customWindow = null
        updateChartFocusLabel()
        if (state.lastCandles.length) renderChart(state.lastCandles)
        else fetchCandles().then(renderChart).catch(console.error)
      }
    })

    const strategiesForPos = data.strategies || []
    const withPosition = strategiesForPos.filter(s => s.position?.open)
    const posContentEl = document.getElementById('position-content')
    const closeAllBtn = document.getElementById('close-all-positions-btn')
    if (closeAllBtn) closeAllBtn.disabled = withPosition.length === 0
    const topCloseAllBtn = document.getElementById('top-close-all-btn')
    if (topCloseAllBtn) topCloseAllBtn.disabled = withPosition.length === 0
    if (withPosition.length === 0) {
      posContentEl.innerHTML = '<div class="row"><span class="label">Status</span><span class="value">No open positions</span></div>'
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

    const configInputIds = ['risk-input', 'sl-input', 'tp-input']
    const anyConfigFocused = configInputIds.some(id => document.getElementById(id) === document.activeElement)
    if (!anyConfigFocused) {
      const envCfg = data.config?.env || {}
      const rtCfg = data.config?.runtime || {}
      document.getElementById('risk-input').value = rtCfg.riskPerTrade != null ? rtCfg.riskPerTrade : envCfg.riskPerTrade ?? ''
      document.getElementById('sl-input').value = rtCfg.stopLossPct != null ? rtCfg.stopLossPct : envCfg.stopLossPct ?? ''
      document.getElementById('tp-input').value = rtCfg.takeProfitPct != null ? rtCfg.takeProfitPct : envCfg.takeProfitPct ?? ''
    }
    const regimeCb = document.getElementById('regime-awareness-cb')
    if (regimeCb) regimeCb.checked = data.config?.regimeFilterEnabled !== false

    const budget = data.config?.budget || {}
    const budgetGlobalEl = document.getElementById('budget-global')
    const budgetPerEl = document.getElementById('budget-per-strategy')
    if (budgetGlobalEl) budgetGlobalEl.textContent = (budget.globalBudgetQuote != null && budget.globalBudgetQuote > 0) ? formatQuote(budget.globalBudgetQuote) + ' USDT' : 'Full portfolio'
    if (budgetPerEl) budgetPerEl.textContent = (budget.strategyBudgetQuote != null && budget.strategyBudgetQuote > 0) ? formatQuote(budget.strategyBudgetQuote) + ' USDT' : 'Full portfolio'

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
    if (volEl) volEl.textContent = regime.volatility ? (regime.volatility.charAt(0).toUpperCase() + regime.volatility.slice(1)) + (regime.volatilityRatio != null ? ' (' + regime.volatilityRatio + '×)' : '') : '–'
    const trendEl = document.getElementById('regime-trend')
    if (trendEl) trendEl.textContent = regime.trend ? (regime.trend.charAt(0).toUpperCase() + regime.trend.slice(1)) + (regime.adx != null ? ' (ADX ' + regime.adx + ')' : '') : '–'
    const dirEl = document.getElementById('regime-direction')
    if (dirEl) dirEl.textContent = regime.trendDirection ? (regime.trendDirection.charAt(0).toUpperCase() + regime.trendDirection.slice(1)) : '–'
    const volRatioEl = document.getElementById('market-volume-ratio')
    if (volRatioEl) volRatioEl.textContent = market.volumeRatio != null ? market.volumeRatio.toFixed(2) + '×' : '–'
    const pctEmaEl = document.getElementById('market-pct-ema200')
    if (pctEmaEl) pctEmaEl.textContent = market.pctFromEma200 != null ? (market.pctFromEma200 >= 0 ? '+' : '') + market.pctFromEma200 + '%' : '–'
    const pctLevelsEl = document.getElementById('market-pct-levels')
    if (pctLevelsEl) pctLevelsEl.textContent = (market.pctFromRecentHigh != null && market.pctFromRecentLow != null) ? (market.pctFromRecentHigh >= 0 ? '+' : '') + market.pctFromRecentHigh + '% / ' + (market.pctFromRecentLow >= 0 ? '+' : '') + market.pctFromRecentLow + '%' : '–'

    const strategiesForPnl = data.strategies || []
    const aggregateRealized = data.pnl?.realized ?? strategiesForPnl.reduce((a, s) => a + (Number(s.realizedPnl) || 0), 0)
    const aggregateUnrealized = data.pnl?.unrealized ?? strategiesForPnl.reduce((a, s) => a + (Number(s.unrealizedPnl) || 0), 0)
    const aggregateTotal = data.pnl?.total ?? (aggregateRealized + aggregateUnrealized)
    const pnlColor = (v) => (v ?? 0) >= 0 ? '#22c55e' : '#ef4444'
    document.getElementById('pnl-realized').textContent = formatPnl(aggregateRealized)
    document.getElementById('pnl-realized').style.color = pnlColor(aggregateRealized)
    document.getElementById('pnl-unrealized').textContent = formatPnl(aggregateUnrealized)
    document.getElementById('pnl-unrealized').style.color = pnlColor(aggregateUnrealized)
    const pnlUnrealizedTopEl = document.getElementById('pnl-unrealized-top')
    if (pnlUnrealizedTopEl) {
      pnlUnrealizedTopEl.textContent = formatPnl(aggregateUnrealized)
      pnlUnrealizedTopEl.style.color = pnlColor(aggregateUnrealized)
    }
    document.getElementById('pnl-total').textContent = formatPnl(aggregateTotal)
    document.getElementById('pnl-total').style.color = pnlColor(aggregateTotal)

    updateChartFocusLabel()
    await updateAnalysisPanel(strategies)
  } catch (err) {
    document.getElementById('action-status').textContent = 'Error: ' + err.message
  }
}

async function refreshChart () {
  try {
    const candles = await fetchCandles()
    renderChart(candles)
  } catch (err) { console.error(err) }
}

async function refreshFees () {
  try {
    const res = await fetch('/api/trades?limit=50')
    if (!res.ok) return
    const data = await res.json()
    updateTradesPanel(data, {
      onTradeRowClick (t0) {
        if (t0.strategyId) {
          state.selectedStrategyId = t0.strategyId
          const tbody = document.getElementById('strategies-tbody')
          const detailPane = document.getElementById('strategy-detail-pane')
          if (tbody) {
            tbody.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'))
            const row = tbody.querySelector('tr[data-strategy-id="' + t0.strategyId + '"]')
            if (row) row.classList.add('selected')
          }
          if (detailPane && state.latestStrategies.length) {
            const strat = state.latestStrategies.find(s => s.id === t0.strategyId)
            if (strat) {
              detailPane.classList.remove('empty')
              detailPane.innerHTML = strategyDetailHtml(strat)
            }
          }
          const strategiesTab = document.querySelector('.tab[data-tab="strategies"]')
          if (strategiesTab) strategiesTab.click()
        }
        updateChartFocusLabel()
        if (!state.lastCandles.length) return
        const ts = t0.timestamp
        if (!ts) return
        const src = state.lastCandles
        let idxC = src.findIndex(c => c.timestamp >= ts)
        if (idxC === -1) idxC = src.length - 1
        const half = 20
        const start = Math.max(0, idxC - half)
        const end = Math.min(src.length, idxC + half + 1)
        state.customWindow = { start, end }
        try {
          localStorage.setItem('customWindowStart', String(start))
          localStorage.setItem('customWindowEnd', String(end))
          if (state.selectedStrategyId) localStorage.setItem('selectedStrategyId', state.selectedStrategyId)
        } catch (err) { console.error(err) }
        renderChart(state.lastCandles)
      }
    })
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
    const res = await fetch('/api/manual-buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { statusEl.textContent = data.error || 'Buy failed'; return }
    statusEl.textContent = data.order ? `Buy order placed (${data.order.id}).` : 'Position opened.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Buy failed: ' + err.message }
})

document.getElementById('sell-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  const amountRaw = document.getElementById('manual-amount').value
  const unit = document.getElementById('manual-unit').value
  const amount = parseFloat(amountRaw)
  const body = (typeof amount === 'number' && amount > 0 && unit) ? { amount, unit } : {}
  statusEl.textContent = body.amount ? `Selling ${amount} ${unit === 'quote' ? 'USDT' : 'BTC'}…` : 'Closing full position (SELL)...'
  try {
    const res = await fetch('/api/manual-sell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { statusEl.textContent = data.error || 'Sell failed'; return }
    statusEl.textContent = data.order ? `Sell order placed (${data.order.id}).` : 'Position closed.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Sell failed: ' + err.message }
})

document.getElementById('apply-config-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  const risk = parseFloat(document.getElementById('risk-input').value)
  const sl = parseFloat(document.getElementById('sl-input').value)
  const tp = parseFloat(document.getElementById('tp-input').value)
  statusEl.textContent = 'Updating config...'
  try {
    await postJson('/api/config', { riskPerTrade: isNaN(risk) ? undefined : risk, stopLossPct: isNaN(sl) ? undefined : sl, takeProfitPct: isNaN(tp) ? undefined : tp })
    statusEl.textContent = 'Config updated.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Config update failed: ' + err.message }
})

document.getElementById('reset-config-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Resetting risk config to .env defaults...'
  try {
    const res = await fetch('/api/config/reset', { method: 'POST' })
    if (!res.ok) { statusEl.textContent = 'Reset failed'; return }
    statusEl.textContent = 'Risk config reset to .env defaults.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Reset failed: ' + err.message }
})

async function resetAllPnl () {
  const statusEl = document.getElementById('action-status')
  if (!confirm('Reset stats and trade history for all strategies?')) return
  statusEl.textContent = 'Resetting stats and trades…'
  try {
    const res = await fetch('/api/reset-all-pnl', { method: 'POST' })
    if (!res.ok) { statusEl.textContent = 'Reset failed'; return }
    statusEl.textContent = 'Stats and trades reset.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Reset failed: ' + err.message }
}
document.getElementById('reset-all-pnl-btn').addEventListener('click', resetAllPnl)
document.getElementById('top-reset-pnl-btn').addEventListener('click', resetAllPnl)

async function startAllStrategies () {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Starting all strategies...'
  try {
    await postJson('/api/strategies/start-all', {})
    statusEl.textContent = 'All strategies started.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Start all failed: ' + err.message
  }
}

async function stopAllStrategies () {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Stopping all strategies...'
  try {
    await postJson('/api/strategies/stop-all', {})
    statusEl.textContent = 'All strategies stopped.'
    await refreshStatus()
  } catch (err) {
    statusEl.textContent = 'Stop all failed: ' + err.message
  }
}

async function toggleAutoTrading () {
  const statusEl = document.getElementById('action-status')
  statusEl.textContent = 'Toggling auto trading...'
  try {
    const current = document.getElementById('bot-auto').textContent.includes('ON')
    await postJson('/api/config', { autoTradingEnabled: !current })
    statusEl.textContent = 'Auto trading toggled.'
    await refreshStatus()
  } catch (err) { statusEl.textContent = 'Toggle failed: ' + err.message }
}
document.getElementById('toggle-auto-btn').addEventListener('click', toggleAutoTrading)
document.getElementById('bot-auto').addEventListener('click', toggleAutoTrading)

const startAllBtn = document.getElementById('start-all-strategies-btn')
if (startAllBtn) startAllBtn.addEventListener('click', startAllStrategies)
const stopAllBtn = document.getElementById('stop-all-strategies-btn')
if (stopAllBtn) stopAllBtn.addEventListener('click', stopAllStrategies)

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
  chartWindowSelect.value = state.chartWindowSize === 'all' ? 'all' : String(state.chartWindowSize)
  chartWindowSelect.addEventListener('change', async (e) => {
    const val = e.target.value
    state.chartWindowSize = val === 'all' ? 'all' : Number(val)
    state.customWindow = null
    try {
      localStorage.setItem('chartWindowSize', val)
      localStorage.removeItem('customWindowStart')
      localStorage.removeItem('customWindowEnd')
    } catch (err) { console.error(err) }
    try {
      if (!state.lastCandles.length) state.lastCandles = await fetchCandles()
      renderChart(state.lastCandles)
    } catch (err) { console.error(err) }
  })
}

const chartResetBtn = document.getElementById('chart-reset-btn')
if (chartResetBtn) {
  chartResetBtn.addEventListener('click', async () => {
    state.customWindow = null
    try {
      localStorage.removeItem('customWindowStart')
      localStorage.removeItem('customWindowEnd')
    } catch (err) { console.error(err) }
    try {
      if (!state.lastCandles.length) state.lastCandles = await fetchCandles()
      renderChart(state.lastCandles)
    } catch (err) { console.error(err) }
  })
}

refreshStatus()
refreshChart()
refreshFees()
setInterval(refreshStatus, 5000)
setInterval(refreshChart, 20000)
setInterval(refreshFees, 20000)

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
    if (state.analysisSortBy === key) state.analysisSortDesc = !state.analysisSortDesc
    else { state.analysisSortBy = key; state.analysisSortDesc = key === 'name' || key === 'type' ? false : true }
    document.querySelectorAll('.analysis-table .sortable').forEach(h => {
      h.classList.remove('sorted-asc', 'sorted-desc')
      if (h.getAttribute('data-sort') === state.analysisSortBy) h.classList.add(state.analysisSortDesc ? 'sorted-desc' : 'sorted-asc')
    })
    updateAnalysisPanel(state.latestStrategies)
  })
})

const analysisTimeRangeEl = document.getElementById('analysis-time-range')
if (analysisTimeRangeEl) analysisTimeRangeEl.addEventListener('change', () => updateAnalysisPanel(state.latestStrategies))
const analysisEquityStrategyEl = document.getElementById('analysis-equity-strategy')
if (analysisEquityStrategyEl) analysisEquityStrategyEl.addEventListener('change', () => updateAnalysisPanel(state.latestStrategies))

const activityGoto = document.getElementById('activity-goto-trades')
if (activityGoto) activityGoto.addEventListener('click', (e) => { e.preventDefault(); const tab = document.querySelector('.tab[data-tab="trades"]'); if (tab) tab.click() })

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
