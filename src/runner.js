import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { logger } from './logger.js'
import { STRATEGY_IDS } from './strategies/registry.js'

const runnerPath = path.join(config.paths.dataDir, 'runner.json')

function getDefaultRunner () {
  return {
    running: ['ema_crossover'],
    regimeFilterEnabled: config.trading.regimeFilterEnabled !== false
  }
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
      return getDefaultRunner()
    }
    const raw = fs.readFileSync(runnerPath, 'utf8')
    if (!raw) return getDefaultRunner()
    const parsed = JSON.parse(raw)
    const def = getDefaultRunner()
    const running = Array.isArray(parsed.running) ? parsed.running.filter(id => STRATEGY_IDS.includes(id)) : def.running
    const regimeFilterEnabled = typeof parsed.regimeFilterEnabled === 'boolean' ? parsed.regimeFilterEnabled : def.regimeFilterEnabled
    return { running, regimeFilterEnabled }
  } catch (err) {
    logger.error('Failed to load runner config', err)
    return getDefaultRunner()
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

export function setRegimeFilterEnabled (enabled) {
  const runner = loadRunner()
  runner.regimeFilterEnabled = !!enabled
  saveRunner(runner)
  logger.info('Regime filter ' + (runner.regimeFilterEnabled ? 'enabled' : 'disabled'))
  return runner
}
