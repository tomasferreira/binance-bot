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
    if (tf && candles != null) {
      metaEl.textContent = `${tf}, ${candles} candles`
    } else if (tf) {
      metaEl.textContent = tf
    } else {
      metaEl.textContent = '–'
    }
  }
}

function renderBacktestTable () {
  const tbody = document.getElementById('backtest-results-tbody')
  if (!tbody) return
  const strategies = Array.isArray(backtestLastStrategies) ? backtestLastStrategies : []
  if (!strategies.length) {
    tbody.innerHTML = '<tr><td colspan="31">No results yet.</td></tr>'
    return
  }

  const enriched = strategies.map(r => {
    const id = r.id || '-'
    const typeTag = id.startsWith('short_') ? 'Short' : 'Long'
    const realized = Number(r.realizedPnl || 0)
    const trades = r.trades ?? 0
    const wins = r.wins ?? 0
    const losses = r.losses ?? 0
    const wl = wins + losses > 0 ? `${wins}/${losses}` : '0/0'
    const winRate = trades > 0 ? (wins / trades) * 100 : null
    const maxDd = Number(r.maxDrawdown || 0)
    return { raw: r, id, typeTag, realized, trades, wins, losses, wl, winRate, maxDd }
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

  tbody.innerHTML = sorted.map(s => {
    const { id, typeTag, realized, trades, wl, winRate, maxDd } = s
    const winRateColor = winRate == null ? '' : (winRate >= 50 ? '#22c55e' : '#ef4444')
    const ddColor = maxDd > 0 ? '#ef4444' : ''
    return '<tr>' +
      '<td>' + id + '</td>' +
      '<td class="numeric">' + typeTag + '</td>' +
      '<td class="numeric" style="color:' + backtestPnlColor(realized) + '">' + fmt(realized) + '</td>' +
      '<td class="numeric" style="color:' + backtestPnlColor(realized) + '">' + fmt(realized) + '</td>' +
      '<td class="numeric">0.00</td>' +
      '<td class="numeric">' + wl + '</td>' +
      '<td class="numeric"' + (winRateColor ? ' style="color:' + winRateColor + '"' : '') + '>' + (winRate != null ? winRate.toFixed(1) : '–') + '</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric"' + (ddColor ? ' style="color:' + ddColor + '"' : '') + '>' + fmt(maxDd) + '</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">' + trades + '</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
      '<td class="numeric">–</td>' +
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
  const riskVal = parseFloat(document.getElementById('backtest-risk').value)
  const slVal = parseFloat(document.getElementById('backtest-sl').value)
  const tpVal = parseFloat(document.getElementById('backtest-tp').value)
  const regime = document.getElementById('backtest-regime').checked
  const intrabar = document.getElementById('backtest-intrabar').checked

  const body = {
    days: Number.isFinite(daysVal) && daysVal > 0 ? daysVal : undefined,
    regime,
    intrabar,
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

