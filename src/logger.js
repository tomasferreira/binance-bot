import fs from 'fs'
import path from 'path'
import winston from 'winston'
import { config } from './config.js'

const logDir = config.paths.logDir

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true })
}

const logFormat = winston.format.printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`
})

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'bot.log')
    })
  ]
})

