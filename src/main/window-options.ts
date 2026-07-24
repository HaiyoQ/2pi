import type { WebPreferences } from 'electron'

export function createWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    // Electron defaults sandbox to true when nodeIntegration is disabled. ESM preload requires it off.
    sandbox: false
  }
}
