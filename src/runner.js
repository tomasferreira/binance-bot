import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { logger } from './logger.js'
import { STRATEGY_IDS } from './strategies/registry.js'

const runnerPath = path.join(config.paths.dataDir, 'runner.json')

const defaultRunner = {
  running: ['ema_crossover'] // default: only EMA Crossover running
}

function ensureDataDir () {
  if (!fs.existsSync(config.paths.dataDir)) {
    fs.mkdirSync(config.paths.dataDir, { recursive: true })
  }
}

export function loadRunner () {
  try {
    ensureDataDir()
    if (!fs.existsSync(runnerPath)) {
      return { ...defaultRunner }
    }
    const raw = fs.readFileSync(runnerPath, 'utf8')
    if (!raw) return { ...defaultRunner }
    const parsed = JSON.parse(raw)
    const running = Array.isArray(parsed.running) ? parsed.running.filter(id => STRATEGY_IDS.includes(id)) : defaultRunner.running
    return { running }
  } catch (err) {
    logger.error('Failed to load runner config', err)
    return { ...defaultRunner }
  }
}

export function saveRunner (runner) {
  try {
    ensureDataDir()
    fs.writeFileSync(runnerPath, JSON.stringify(runner, null, 2))
  } catch (err) {
    logger.error('Failed to save runner config', err)
  }
}

export function isRunning (strategyId) {
  const runner = loadRunner()
  return runner.running.includes(strategyId)
}

export function setRunning (strategyId, running) {
  const runner = loadRunner()
  const has = runner.running.includes(strategyId)
  if (running && !has) {
    runner.running.push(strategyId)
    saveRunner(runner)
    logger.info(`Strategy ${strategyId} started`)
  } else if (!running && has) {
    runner.running = runner.running.filter(id => id !== strategyId)
    saveRunner(runner)
    logger.info(`Strategy ${strategyId} stopped`)
  }
  return runner
}
