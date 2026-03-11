import fs from 'fs'
import path from 'path'
import winston from 'winston'
import { config } from './config.js'

const logDir = config.paths.logDir

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

// Map user-friendly LOG_LEVEL to winston level
function resolveLogLevel () {
  const raw = (config.logging?.level || 'INFO').toUpperCase()
  if (raw === 'DEBUG') return 'debug'
  if (raw === 'WARN' || raw === 'WARNING') return 'warn'
  return 'info'
}

const fileMaxSizeBytes = Math.max(1, config.logging?.maxSizeMB || 10) * 1024 * 1024
const fileMaxFiles = Math.max(1, config.logging?.maxFiles || 5)

const logFormat = winston.format.printf(info => {
  const { level, message, timestamp, stack, metadata } = info
  const base = `${timestamp} [${level}] ${stack || message}`
  if (metadata && Object.keys(metadata).length > 0) {
    return `${base} ${JSON.stringify(metadata)}`
  }
  return base
})

const backtestLogFormat = winston.format.printf(info => {
  const { level, message, timestamp, stack, metadata } = info
  const base = `${timestamp} [${level}] [Backtest] ${stack || message}`
  if (metadata && Object.keys(metadata).length > 0) {
    return `${base} ${JSON.stringify(metadata)}`
  }
  return base
})

export const logger = winston.createLogger({
  level: resolveLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'bot.log'),
      maxsize: fileMaxSizeBytes,
      maxFiles: fileMaxFiles,
      tailable: true
    })
  ]
})

/** Logger for backtest runs: same level/format as main logger, but writes to logs/backtest.log with [Backtest] prefix */
export const backtestLogger = winston.createLogger({
  level: resolveLogLevel(),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
    backtestLogFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
        backtestLogFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'backtest.log'),
      maxsize: fileMaxSizeBytes,
      maxFiles: fileMaxFiles,
      tailable: true
    })
  ]
})

