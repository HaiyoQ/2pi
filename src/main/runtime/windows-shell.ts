import { spawn } from 'node:child_process'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

const UTF8_PREFIX = '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); '

export function createPowerShellOperations(): BashOperations {
  return {
    exec(command, cwd, options) {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) return reject(new Error('aborted'))
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `${UTF8_PREFIX}${command}`], {
          cwd,
          env: options.env ?? process.env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        child.stdout.on('data', options.onData)
        child.stderr.on('data', options.onData)
        child.once('error', reject)

        let timer: NodeJS.Timeout | undefined
        const stop = () => child.kill()
        if (options.timeout) timer = setTimeout(stop, options.timeout * 1000)
        options.signal?.addEventListener('abort', stop, { once: true })
        child.once('close', (exitCode) => {
          if (timer) clearTimeout(timer)
          options.signal?.removeEventListener('abort', stop)
          resolve({ exitCode })
        })
      })
    }
  }
}
