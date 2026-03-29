/**
 * Bootstraps the Electron main process and wires application lifecycle events to EnvSetup services.
 */

import { app, BrowserWindow, nativeImage } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerIpcHandlers } from './ipc/index'

const __dirname = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null

export function getMainWindow() {
  return mainWindow
}

// 指向项目根目录下的 build/ 图标
const ICON_DIR = join(__dirname, '../../build')

function getIcon() {
  if (process.platform === 'win32') {
    return nativeImage.createFromPath(join(ICON_DIR, 'icon.ico'))
  }
  if (process.platform === 'linux') {
    return nativeImage.createFromPath(join(ICON_DIR, 'icon.png'))
  }
  // macOS：图标由 .icns 随 app bundle 自动加载，此处返回 PNG 供 Dock 使用
  return nativeImage.createFromPath(join(ICON_DIR, 'icon.png'))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // 开发模式下 macOS Dock 图标默认是 Electron，手动替换
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(join(ICON_DIR, 'icon.png')))
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
