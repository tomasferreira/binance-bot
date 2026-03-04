let backtestPollTimer = null

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
  const tbody = document.getElementById('backtest-results-tbody')
  const totalEl = document.getElementById('backtest-total-pnl')
  if (!statusEl || !tbody || !totalEl) return

  const s = status || { status: 'idle' }
  statusEl.textContent = `Status: ${s.status}${s.exitCode != null ? ' (code ' + s.exitCode + ')' : ''}`

  const summary = s.summary || {}
  const strategies = Array.isArray(summary.strategies) ? summary.strategies : []
  if (!strategies.length) {
    tbody.innerHTML = '<tr><td colspan="31">No results yet.</td></tr>'
  } else {
    const pnlColor = (v) => (v ?? 0) >= 0 ? '#22c55e' : '#ef4444'
    tbody.innerHTML = strategies.map(r => {
      const id = r.id || '-'
      const typeTag = id.startsWith('short_') ? 'Short' : 'Long'
      const realized = Number(r.realizedPnl || 0)
      const trades = r.trades ?? 0
      const wins = r.wins ?? 0
      const losses = r.losses ?? 0
      const wl = wins + losses > 0 ? `${wins}/${losses}` : '0/0'
      const winRate = trades > 0 ? (wins / trades) * 100 : null
      const maxDd = Number(r.maxDrawdown || 0)

      const fmt = (v) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(2)
      const pct = (v) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(1) + '%'
      const winRateColor = winRate == null ? '' : (winRate >= 50 ? '#22c55e' : '#ef4444')
      const ddColor = maxDd > 0 ? '#ef4444' : ''

      return '<tr>' +
        '<td>' + id + '</td>' +
        '<td class="numeric">' + typeTag + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(realized) + '">' + fmt(realized) + '</td>' + // total PnL (no unrealized)
        '<td class="numeric" style="color:' + pnlColor(realized) + '">' + fmt(realized) + '</td>' +
        '<td class="numeric">0.00</td>' + // unrealized
        '<td class="numeric">' + wl + '</td>' +
        '<td class="numeric"' + (winRateColor ? ' style="color:' + winRateColor + '"' : '') + '>' + (winRate != null ? winRate.toFixed(1) : '–') + '</td>' +
        '<td class="numeric">–</td>' + // avg win
        '<td class="numeric">–</td>' + // avg loss
        '<td class="numeric">–</td>' + // sharpe
        '<td class="numeric"' + (ddColor ? ' style="color:' + ddColor + '"' : '') + '>' + fmt(maxDd) + '</td>' +
        '<td class="numeric">–</td>' + // calmar
        '<td class="numeric">–</td>' + // recovery
        '<td class="numeric">–</td>' + // curr DD %
        '<td class="numeric">' + trades + '</td>' +
        '<td class="numeric">–</td>' + // trades (hist)
        '<td class="numeric">–</td>' + // fees
        '<td class="numeric">–</td>' + // exposure
        '<td class="numeric">–</td>' + // avg duration
        '<td class="numeric">–</td>' + // streak
        '<td class="numeric">–</td>' + // max streak
        '<td class="numeric">–</td>' + // avg hold
        '<td class="numeric">–</td>' + // cost/trade
        '<td class="numeric">–</td>' + // time in profit %
        '<td class="numeric">–</td>' + // profit factor
        '<td class="numeric">–</td>' + // expectancy
        '<td class="numeric">–</td>' + // max win
        '<td class="numeric">–</td>' + // max loss
        '<td class="numeric">–</td>' + // sortino
        '<td class="numeric">–</td>' + // trades/day
        '<td class="numeric">–</td>' + // last trade
        '</tr>'
    }).join('')
  }
  const total = summary.totalPnl
  if (typeof total === 'number' && !isNaN(total)) {
    totalEl.textContent = total.toFixed(2) + ' USDT'
    totalEl.style.color = total >= 0 ? '#22c55e' : '#ef4444'
  } else {
    totalEl.textContent = '-'
    totalEl.style.color = ''
  }
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
  // Refresh status if a run already exists
  pollBacktestStatus().catch(() => {})
}

