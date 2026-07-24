import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { registerIpc } from './ipc'
import { AgentRuntime } from './runtime/agent-runtime'
import { SettingsStore, type SecretCodec } from './runtime/settings-store'
import { createWebPreferences } from './window-options'

let mainWindow: BrowserWindow | undefined

async function createWindow(): Promise<void> {
  const codec: SecretCodec = {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，无法保存 API Key')
      return safeStorage.encryptString(value).toString('base64')
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    }
  }
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), codec)
  await settings.load()
  const runtime = new AgentRuntime(app.getPath('userData'), settings)
  await runtime.initialize()

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#f4f5f7',
    title: '2π 编程助手',
    webPreferences: createWebPreferences(join(__dirname, '../preload/index.mjs'))
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  registerIpc(mainWindow, runtime, settings)
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
