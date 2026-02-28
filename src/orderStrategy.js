import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { logger } from './logger.js'

const dataDir = config.paths.dataDir
const filePath = path.join(dataDir, 'order_strategy.json')

function ensureDataDir () {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function loadMap () {
  try {
    ensureDataDir()
    if (!fs.existsSync(filePath)) return {}
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw?.trim()) return {}
    return JSON.parse(raw)
  } catch (err) {
    logger.warn('orderStrategy: could not load map', err)
    return {}
  }
}

/** @param {string} orderId @param {string} strategyId @param {string} [reason] @param {object} [detail] @param {number} [pnl] PnL when this order closed a position */
export function recordOrderStrategy (orderId, strategyId, reason = null, detail = null, pnl = null) {
  if (!orderId || !strategyId) return
  try {
    ensureDataDir()
    const map = loadMap()
    const hasMeta = reason != null || (detail != null && typeof detail === 'object') || (pnl != null && typeof pnl === 'number')
    map[String(orderId)] = hasMeta
      ? { strategyId, reason: reason ?? null, detail: detail && typeof detail === 'object' ? detail : null, pnl: typeof pnl === 'number' ? pnl : null }
      : strategyId
    fs.writeFileSync(filePath, JSON.stringify(map, null, 2))
  } catch (err) {
    logger.warn('orderStrategy: could not save', err)
  }
}

export function getStrategyIdForOrder (orderId) {
  const map = loadMap()
  const v = map[String(orderId)]
  return typeof v === 'string' ? v : (v?.strategyId ?? null)
}

export function getOrderReasonForOrder (orderId) {
  const map = loadMap()
  const v = map[String(orderId)]
  return typeof v === 'object' && v != null ? (v.reason ?? null) : null
}

export function getOrderDetailForOrder (orderId) {
  const map = loadMap()
  const v = map[String(orderId)]
  return typeof v === 'object' && v != null && v.detail ? v.detail : null
}

export function getOrderStrategyMap () {
  return loadMap()
}
