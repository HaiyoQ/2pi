import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { registerIpc } from './ipc'
import { AgentRuntime } from './runtime/agent-runtime'
import { createSecretCodec } from './runtime/secret-codec'
import { SettingsStore } from './runtime/settings-store'
import { createWebPreferences } from './window-options'

let mainWindow: BrowserWindow | undefined

async function createWindow(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const codec = await createSecretCodec(userDataPath, safeStorage)
  const settings = new SettingsStore(join(userDataPath, 'settings.json'), codec)
  await settings.load()
  const runtime = new AgentRuntime(userDataPath, settings)
  await runtime.initialize()

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#ffffff',
    title: 'LOOP',
    webPreferences: createWebPreferences(join(__dirname, '../preload/index.mjs'))
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  registerIpc(mainWindow, runtime)
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
