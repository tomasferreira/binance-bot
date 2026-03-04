import { spawn } from 'child_process'
import { logger } from './logger.js'
import { run } from './bot.js'
import { createApp, getApiPort } from './api.js'

// Prevent macOS from sleeping while the bot is running
let caffeinateChild = null
if (process.platform === 'darwin') {
  caffeinateChild = spawn('caffeinate', ['-i', '-d'], { stdio: 'ignore' })
  caffeinateChild.on('error', () => {})
  process.on('exit', () => { if (caffeinateChild) caffeinateChild.kill() })
}

async function start () {
  await run()
  const app = createApp()
  const apiPort = getApiPort()
  app.listen(apiPort, () => {
    logger.info(`HTTP API & dashboard listening on http://localhost:${apiPort}`)
  })
}

start().catch(err => {
  logger.error('Fatal error in start()', err)
  process.exit(1)
})
