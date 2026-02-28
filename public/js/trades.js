import { formatPrice, formatAmount, formatQuote, formatPnl, escapeHtml, formatTime24h, formatTimeAgo, formatDate24h } from './utils.js'
import { state } from './state.js'

function formatActivityTime (ev) {
  if (ev.timestamp != null) return formatTime24h(ev.timestamp, true) + ' (' + formatTimeAgo(ev.timestamp) + ')'
  return ev.time != null ? String(ev.time) : '–'
}

/** Re-render activity list DOM so "ago" timestamps update (call on each poll). */
export function refreshActivityListDisplay () {
  if (!state.activityEvents.length) return
  const listEl = document.getElementById('activity-list')
  if (listEl) {
    listEl.innerHTML = state.activityEvents
      .map(ev => '<div class="activity-item">' +
        '<span class="activity-time">' + escapeHtml(formatActivityTime(ev)) + '</span>' +
        '<span class="activity-message">' + escapeHtml(ev.message) + '</span></div>')
      .join('')
  }
  const overviewEl = document.getElementById('activity-overview')
  if (overviewEl) {
    overviewEl.innerHTML = state.activityEvents.slice(0, 5).map(ev => '<div class="activity-item">' +
      '<span class="activity-time">' + escapeHtml(formatActivityTime(ev)) + '</span>' +
      '<span class="activity-message">' + escapeHtml(ev.message) + '</span></div>').join('') || '<small>No recent events.</small>'
  }
}

export function addActivityEvent (message, level, showToast) {
  const now = Date.now()
  const item = { timestamp: now, message, level }
  state.activityEvents.unshift(item)
  if (state.activityEvents.length > 50) state.activityEvents.pop()
  const html = state.activityEvents
    .map(ev => '<div class="activity-item">' +
      '<span class="activity-time">' + escapeHtml(formatActivityTime(ev)) + '</span>' +
      '<span class="activity-message">' + escapeHtml(ev.message) + '</span>' +
    '</div>')
    .join('')
  const listEl = document.getElementById('activity-list')
  if (listEl) listEl.innerHTML = html
  const overviewEl = document.getElementById('activity-overview')
  if (overviewEl) overviewEl.innerHTML = state.activityEvents.slice(0, 5).map(ev => '<div class="activity-item">' +
    '<span class="activity-time">' + escapeHtml(formatActivityTime(ev)) + '</span>' +
    '<span class="activity-message">' + escapeHtml(ev.message) + '</span></div>').join('') || '<small>No recent events.</small>'
  if (showToast) showToast(message, level)
}

export function updatePositionActivity (strategies, market, showToast) {
  const nextSnapshot = {}
  const lastPrice = market?.lastPrice

  if (!state.activityInitialized) {
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
    state.lastStrategySnapshot = nextSnapshot
    state.activityInitialized = true
    return
  }

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
    const prev = state.lastStrategySnapshot[id]

    if (prev && !prev.open && curr.open) {
      if (curr.open && curr.amount > 0) {
        const sideLabel = (curr.side || 'long').toUpperCase()
        const msg = `Opened ${sideLabel} ${formatAmount(curr.amount)} @ ${formatPrice(curr.entryPrice)} (${name})`
        addActivityEvent(msg, 'success', showToast)
      }
    } else if (prev && prev.open && !curr.open) {
      const deltaPnl = (curr.realizedPnl ?? 0) - (prev.realizedPnl ?? 0)
      const sideLabel = (prev.side || 'long').toUpperCase()
      const level = deltaPnl >= 0 ? 'success' : 'error'
      const pnlText = formatPnl(deltaPnl).replace(' USDT', '')
      const priceText = lastPrice != null ? ` @ ${formatPrice(lastPrice)}` : ''
      const msg = `Closed ${sideLabel} ${formatAmount(prev.amount)}${priceText} (${name}), PnL ${pnlText}`
      addActivityEvent(msg, level, showToast)
    }

    nextSnapshot[id] = curr
  })

  state.lastStrategySnapshot = nextSnapshot
}

function formatDetail (detail) {
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

/**
 * Updates fees total and trades table. callbacks.onTradeRowClick(t0) when a trade row is clicked.
 */
export function updateTradesPanel (data, callbacks) {
  const el = document.getElementById('fees-total')
  if (data.totalFeeEstimate != null) {
    el.textContent = (data.feeCurrency || 'USDT') + ' ' +
      Number(data.totalFeeEstimate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  } else {
    el.textContent = '–'
  }
  state.latestTrades = Array.isArray(data.trades) ? data.trades : []
  const raw = state.latestTrades.slice(0, 50)
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

  const tbody = document.getElementById('trades-tbody')
  if (groups.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11">No trades</td></tr>'
  } else {
    tbody.innerHTML = groups.map((grp, grpIdx) => {
      const trades = grp.trades
      const t0 = trades[0]
      const n = trades.length
      const timeStr = n === 1
        ? (t0.timestamp ? formatDate24h(t0.timestamp) : '–')
        : (t0.timestamp && trades[n - 1].timestamp
          ? formatDate24h(t0.timestamp) + ' … ' + formatTime24h(trades[n - 1].timestamp) + ' (' + formatTimeAgo(trades[n - 1].timestamp) + ')'
          : '–')
      const orderIdStr = grp.orderId != null ? String(grp.orderId) : '–'
      const sideClass = t0.side === 'buy' ? 'side-buy' : 'side-sell'
      const strategyStr = t0.strategyName || t0.strategyId || '–'
      const reasonStr = t0.reason || '–'
      const orderPnl = t0.orderPnl != null ? t0.orderPnl : null
      const pnlStr = orderPnl != null ? formatPnl(orderPnl).replace(' USDT', '') : '–'
      const pnlColor = orderPnl != null ? (orderPnl >= 0 ? '#22c55e' : '#ef4444') : 'inherit'
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
        '<td class="numeric" style="color:' + pnlColor + '">' + pnlStr + '</td>' +
        '<td class="detail-cell" title="' + (n === 1 ? formatDetail(t0.detail).replace(/"/g, '&quot;') : '') + '">' + detailStr + '</td>' +
        '<td>' + formatAmount(totalAmount) + '</td>' +
        '<td>' + formatPrice(avgPrice) + '</td>' +
        '<td>' + costStr + '</td>' +
        '<td>' + feeStr + '</td></tr>'
    }).join('')

    Array.from(tbody.querySelectorAll('tr[data-group-index]')).forEach((row) => {
      const idx = parseInt(row.getAttribute('data-group-index'), 10)
      const grp = groups[idx]
      if (!grp || !grp.trades.length) return
      const t0 = grp.trades[0]
      row.addEventListener('click', () => {
        if (callbacks?.onTradeRowClick) callbacks.onTradeRowClick(t0)
      })
    })
  }
}
