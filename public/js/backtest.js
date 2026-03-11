let backtestPollTimer = null
let backtestLastStrategies = []
let backtestSortBy = 'id'
let backtestSortDesc = false

function backtestPnlColor (v) {
  const n = v ?? 0
  if (Number.isNaN(n)) return ''
  if (n > 0) return '#22c55e'
  if (n < 0) return '#ef4444'
  return '#eab308' // neutral (zero) = yellow
}

async function fetchBacktestStatus () {
  try {
    const res = await fetch('/api/backtest/status')
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function renderBacktestStatus (status) {
  const statusEl = document.getElementById('backtest-status-text')
  const totalEl = document.getElementById('backtest-total-pnl')
  if (!statusEl || !totalEl) return

  const s = status || { status: 'idle' }
  statusEl.textContent = `Status: ${s.status}${s.exitCode != null ? ' (code ' + s.exitCode + ')' : ''}`

  const summary = s.summary || {}
  const strategies = Array.isArray(summary.strategies) ? summary.strategies : []
  backtestLastStrategies = strategies
  renderBacktestTable()
  const total = summary.totalPnl
  if (typeof total === 'number' && !isNaN(total)) {
    totalEl.textContent = total.toFixed(2) + ' USDT'
    totalEl.style.color = backtestPnlColor(total)
  } else {
    totalEl.textContent = '-'
    totalEl.style.color = ''
  }
  const metaEl = document.getElementById('backtest-meta')
  if (metaEl) {
    const meta = summary.meta || {}
    const tf = meta.timeframe || '–'
    const candles = typeof meta.candles === 'number' ? meta.candles : null
    const totalTrades = typeof meta.totalTrades === 'number' ? meta.totalTrades : null
    const slippagePct = typeof meta.slippagePct === 'number' && meta.slippagePct > 0 ? meta.slippagePct : null
    const durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : null
    const enabled = strategies.filter(r => r.recommendation === 'enable').map(r => r.id)
    const parts = []
    if (tf) parts.push(tf)
    if (candles != null) parts.push(`${candles} candles`)
    if (totalTrades != null) parts.push(`${totalTrades} trades`)
    if (slippagePct != null) parts.push((slippagePct * 100).toFixed(2) + '% slippage')
    if (durationMs != null) {
      const seconds = durationMs / 1000
      const formatted = seconds < 10
        ? seconds.toFixed(2) + 's'
        : seconds < 120
          ? seconds.toFixed(1) + 's'
          : (seconds / 60).toFixed(1) + 'm'
      parts.push(formatted)
    }
    if (enabled.length) {
      parts.push(`Reco: ${enabled.join(', ')}`)
    }
    metaEl.textContent = parts.length ? parts.join(', ') : '–'
  }
}

function renderBacktestTable () {
  const tbody = document.getElementById('backtest-results-tbody')
  if (!tbody) return
  const strategies = Array.isArray(backtestLastStrategies) ? backtestLastStrategies : []
  if (!strategies.length) {
    tbody.innerHTML = '<tr><td colspan="32">No results yet.</td></tr>'
    return
  }

  const enriched = strategies.map(r => {
    const id = r.id || '-'
    const rawDir = r.direction || (id.startsWith('short_') ? 'short' : 'long')
    const typeTag = rawDir === 'both' ? 'Both' : (rawDir === 'short' ? 'Short' : 'Long')
    const reco = r.recommendation || 'insufficient-data'
    const recoReason = r.recommendationReason || ''
    const realized = Number(r.realizedPnl || 0)
    const trades = r.trades ?? 0
    const wins = r.wins ?? 0
    const losses = r.losses ?? 0
    const wl = wins + losses > 0 ? `${wins}/${losses}` : '0/0'
    const winRate = typeof r.winRate === 'number' ? r.winRate * 100 : (trades > 0 ? (wins / trades) * 100 : null)
    const maxDd = Number(r.maxDrawdown || 0)
    return {
      raw: r,
      id,
      typeTag,
      reco,
      _recoReason: recoReason,
      realized,
      trades,
      wins,
      losses,
      wl,
      winRate,
      maxDd,
      avgWin: r.avgWin ?? null,
      avgLoss: r.avgLoss ?? null,
      sharpe: r.sharpe ?? null,
      profitFactor: r.profitFactor ?? null,
      expectancy: r.expectancy ?? null,
      maxWin: r.maxWin ?? null,
      maxLoss: r.maxLoss ?? null,
      sortino: r.sortino ?? null,
      tradesPerDay: r.tradesPerDay ?? null,
      timeInProfitPct: r.timeInProfitPct ?? null,
      calmarRatio: r.calmarRatio ?? null,
      recoveryFactor: r.recoveryFactor ?? null,
      currentDrawdownPct: r.currentDrawdownPct ?? null
    }
  })

  const sorted = [...enriched].sort((a, b) => {
    const key = backtestSortBy
    let va
    let vb
    if (key === 'id') {
      va = a.id
      vb = b.id
      return backtestSortDesc ? vb.localeCompare(va) : va.localeCompare(vb)
    }
    if (key === 'reco') {
      va = a.reco || ''
      vb = b.reco || ''
      return backtestSortDesc ? vb.localeCompare(va) : va.localeCompare(vb)
    }
    if (key === 'type') {
      va = a.typeTag
      vb = b.typeTag
      return backtestSortDesc ? vb.localeCompare(va) : va.localeCompare(vb)
    }
    if (key === 'totalPnl' || key === 'realizedPnl') {
      va = a.realized
      vb = b.realized
    } else if (key === 'winRate') {
      va = a.winRate ?? -Infinity
      vb = b.winRate ?? -Infinity
    } else if (key === 'trades') {
      va = a.trades
      vb = b.trades
    } else if (key === 'maxDrawdown') {
      va = a.maxDd
      vb = b.maxDd
    } else if (key === 'avgWin') {
      va = a.avgWin
      vb = b.avgWin
    } else if (key === 'avgLoss') {
      va = a.avgLoss
      vb = b.avgLoss
    } else if (key === 'sharpe') {
      va = a.sharpe
      vb = b.sharpe
    } else if (key === 'calmar') {
      va = a.calmarRatio
      vb = b.calmarRatio
    } else if (key === 'recovery') {
      va = a.recoveryFactor
      vb = b.recoveryFactor
    } else if (key === 'currentDrawdownPct') {
      va = a.currentDrawdownPct
      vb = b.currentDrawdownPct
    } else if (key === 'timeInProfitPct') {
      va = a.timeInProfitPct
      vb = b.timeInProfitPct
    } else if (key === 'profitFactor') {
      va = a.profitFactor
      vb = b.profitFactor
    } else if (key === 'expectancy') {
      va = a.expectancy
      vb = b.expectancy
    } else if (key === 'maxWin') {
      va = a.maxWin
      vb = b.maxWin
    } else if (key === 'maxLoss') {
      va = a.maxLoss
      vb = b.maxLoss
    } else if (key === 'sortino') {
      va = a.sortino
      vb = b.sortino
    } else if (key === 'tradesPerDay') {
      va = a.tradesPerDay
      vb = b.tradesPerDay
    } else if (key === 'lastTrade') {
      va = a.lastTradeTs ?? -Infinity
      vb = b.lastTradeTs ?? -Infinity
    } else {
      va = 0
      vb = 0
    }
    const na = Number(va)
    const nb = Number(vb)
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0
    if (Number.isNaN(na)) return 1
    if (Number.isNaN(nb)) return -1
    return backtestSortDesc ? nb - na : na - nb
  })

  const fmt = (v) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(2)
  const fmtPct = (v) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(1) + '%'

  tbody.innerHTML = sorted.map(s => {
    const {
      id,
      typeTag,
      reco,
      realized,
      trades,
      wl,
      winRate,
      maxDd,
      avgWin,
      avgLoss,
      sharpe,
      profitFactor,
      expectancy,
      maxWin,
      maxLoss,
      sortino,
      tradesPerDay,
      timeInProfitPct,
      calmarRatio,
      recoveryFactor,
      currentDrawdownPct
    } = s
    const winRateColor = winRate == null ? '' : (winRate >= 50 ? '#22c55e' : '#ef4444')
    const ddColor = maxDd > 0 ? '#ef4444' : ''
    const recoLower = (reco || '').toLowerCase()
    const recoColor = recoLower === 'enable'
      ? '#22c55e'
      : recoLower === 'disable'
        ? '#ef4444'
        : '#9ca3af'
    return '<tr>' +
      '<td>' + id + '</td>' +
      '<td class="numeric">' + typeTag + '</td>' +
      '<td class="numeric" style="color:' + recoColor + '" title="' + (s._recoReason || '') + '">' + (reco || '–') + '</td>' +
      '<td class="numeric" style="color:' + backtestPnlColor(realized) + '">' + fmt(realized) + '</td>' +
      '<td class="numeric" style="color:' + backtestPnlColor(realized) + '">' + fmt(realized) + '</td>' +
      '<td class="numeric">0.00</td>' +
      '<td class="numeric">' + wl + '</td>' +
      '<td class="numeric"' + (winRateColor ? ' style="color:' + winRateColor + '"' : '') + '>' + (winRate != null ? winRate.toFixed(1) : '–') + '</td>' +
      '<td class="numeric" style="color:#22c55e">' + fmt(avgWin) + '</td>' +
      '<td class="numeric" style="color:#ef4444">' + fmt(avgLoss) + '</td>' +
      '<td class="numeric">' + fmt(sharpe) + '</td>' +
      '<td class="numeric"' + (ddColor ? ' style="color:' + ddColor + '"' : '') + '>' + fmt(maxDd) + '</td>' +
      '<td class="numeric">' + fmt(calmarRatio) + '</td>' +
      '<td class="numeric">' + fmt(recoveryFactor) + '</td>' +
      '<td class="numeric">' + fmtPct(currentDrawdownPct) + '</td>' +
      '<td class="numeric">' + trades + '</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">' + fmtPct(timeInProfitPct) + '</td>' +
      '<td class="numeric">' + (profitFactor == null ? '–' : (profitFactor === Infinity ? '∞' : fmt(profitFactor))) + '</td>' +
      '<td class="numeric" style="color:' + backtestPnlColor(expectancy) + '">' + fmt(expectancy) + '</td>' +
      '<td class="numeric">' + fmt(maxWin) + '</td>' +
      '<td class="numeric">' + fmt(maxLoss) + '</td>' +
      '<td class="numeric">' + (sortino == null ? '–' : (sortino === Infinity ? '∞' : (sortino === -Infinity ? '-∞' : fmt(sortino)))) + '</td>' +
      '<td class="numeric">' + (tradesPerDay != null ? tradesPerDay.toFixed(1) : '–') + '</td>' +
      '<td class="numeric">–</td>' +
      '</tr>'
  }).join('')
}

async function pollBacktestStatus () {
  const s = await fetchBacktestStatus()
  if (s) renderBacktestStatus(s)
  if (s && (s.status === 'running' || s.status === 'stopping')) {
    backtestPollTimer = setTimeout(pollBacktestStatus, 2000)
  } else if (!s) {
    backtestPollTimer = setTimeout(pollBacktestStatus, 2000)
  } else {
    backtestPollTimer = null
  }
}

async function startBacktest () {
  const statusLine = document.getElementById('backtest-status-text')
  if (statusLine) statusLine.textContent = 'Starting backtest...'
  const daysVal = parseInt(document.getElementById('backtest-days').value, 10)
  const timeframeEl = document.getElementById('backtest-timeframe')
  const timeframeVal = timeframeEl ? timeframeEl.value : '15m'
  const riskVal = parseFloat(document.getElementById('backtest-risk').value)
  const slVal = parseFloat(document.getElementById('backtest-sl').value)
  const tpVal = parseFloat(document.getElementById('backtest-tp').value)
  const regime = document.getElementById('backtest-regime').checked
  const intrabar = document.getElementById('backtest-intrabar').checked
  const slippageInput = document.getElementById('backtest-slippage')
  const slippageVal = slippageInput != null ? parseFloat(slippageInput.value) : NaN
  const slippage = Number.isFinite(slippageVal) && slippageVal >= 0 && slippageVal <= 1 ? slippageVal / 100 : undefined

  const body = {
    days: Number.isFinite(daysVal) && daysVal > 0 ? daysVal : undefined,
    timeframe: timeframeVal,
    regime,
    intrabar,
    slippage,
    risk: Number.isFinite(riskVal) && riskVal > 0 ? riskVal : undefined,
    sl: Number.isFinite(slVal) && slVal > 0 ? slVal : undefined,
    tp: Number.isFinite(tpVal) && tpVal > 0 ? tpVal : undefined
  }

  try {
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (statusLine) statusLine.textContent = data.error || 'Backtest failed to start'
      return
    }
    if (statusLine) statusLine.textContent = 'Backtest started (pid ' + (data.pid || '?') + ').'
    if (backtestPollTimer) clearTimeout(backtestPollTimer)
    backtestPollTimer = setTimeout(pollBacktestStatus, 2000)
  } catch (err) {
    if (statusLine) statusLine.textContent = 'Backtest start error: ' + err.message
  }
}

async function stopBacktest () {
  const statusLine = document.getElementById('backtest-status-text')
  if (statusLine) statusLine.textContent = 'Stopping backtest...'
  try {
    const res = await fetch('/api/backtest/stop', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (statusLine) statusLine.textContent = data.error || 'No running backtest'
      return
    }
    if (statusLine) statusLine.textContent = 'Backtest stopping (pid ' + (data.pid || '?') + ').'
    if (backtestPollTimer) clearTimeout(backtestPollTimer)
    backtestPollTimer = setTimeout(pollBacktestStatus, 2000)
  } catch (err) {
    if (statusLine) statusLine.textContent = 'Backtest stop error: ' + err.message
  }
}

export function initBacktestControls () {
  const backtestStartBtn = document.getElementById('backtest-start-btn')
  if (backtestStartBtn) backtestStartBtn.addEventListener('click', startBacktest)
  const backtestStopBtn = document.getElementById('backtest-stop-btn')
  if (backtestStopBtn) backtestStopBtn.addEventListener('click', stopBacktest)
  const sortableHeaders = document.querySelectorAll('#panel-backtest .analysis-table .sortable')
  sortableHeaders.forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort')
      if (!key) return
      if (backtestSortBy === key) backtestSortDesc = !backtestSortDesc
      else {
        backtestSortBy = key
        backtestSortDesc = key === 'id' || key === 'type' ? false : true
      }
      document.querySelectorAll('#panel-backtest .analysis-table .sortable').forEach(h => {
        h.classList.remove('sorted-asc', 'sorted-desc')
        if (h.getAttribute('data-sort') === backtestSortBy) h.classList.add(backtestSortDesc ? 'sorted-desc' : 'sorted-asc')
      })
      renderBacktestTable()
    })
  })
  // Refresh status if a run already exists
  pollBacktestStatus().catch(() => {})
}

