export function formatBoolPill (value) {
  const cls = value ? 'status-pill pill-ok' : 'status-pill pill-warn'
  const label = value ? 'ON' : 'OFF'
  return '<span class="' + cls + '">' + label + '</span>'
}

export function formatPrice (n) {
  if (n == null || isNaN(n)) return '–'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatAmount (n) {
  if (n == null || isNaN(n)) return '–'
  const x = Number(n)
  return x >= 1 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export function formatQuote (n) {
  if (n == null || isNaN(n)) return '–'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPnl (n) {
  if (n == null || isNaN(n)) return '–'
  const x = Number(n)
  const s = x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT'
  return x > 0 ? '+' + s : x < 0 ? s : s
}

export function escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Relative time: "5m ago", "2h:30m ago", "3d ago". */
export function formatTimeAgo (timestamp) {
  if (timestamp == null) return ''
  const ms = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()
  const now = Date.now()
  const diff = now - ms
  if (diff < 0) return ''
  const min = Math.floor(diff / 60000)
  const h = Math.floor(min / 60)
  const d = Math.floor(h / 24)
  if (d >= 1) return d + 'd ago'
  if (h >= 1) return h + 'h:' + (min % 60) + 'm ago'
  if (min >= 1) return min + 'm ago'
  return '<1m ago'
}

const opts24 = { hour12: false }

/**
 * Format date/time in 24h. Options: includeDate, includeTime, includeAgo (append " (xm ago)" or " (xh:m ago)").
 * @param {number|string|Date} timestamp
 * @param {{ includeDate?: boolean, includeTime?: boolean, includeAgo?: boolean }} opts
 */
export function formatDate24h (timestamp, opts = {}) {
  const { includeDate = true, includeTime = true, includeAgo = true } = opts
  if (timestamp == null) return '–'
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (isNaN(d.getTime())) return '–'
  const parts = []
  if (includeDate) parts.push(d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }))
  if (includeTime) parts.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', ...opts24 }))
  let s = parts.join(' ')
  if (includeAgo) {
    const ago = formatTimeAgo(timestamp)
    if (ago) s += ' (' + ago + ')'
  }
  return s
}

/** Time only in 24h, optional seconds. */
export function formatTime24h (timestamp, withSeconds = false) {
  if (timestamp == null) return '–'
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (isNaN(d.getTime())) return '–'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), ...opts24 })
}
