import { contextBridge, ipcRenderer } from 'electron'

import type { EnvSetupApi } from '../main/core/contracts'

const api: EnvSetupApi = {
  listTemplates: () => ipcRenderer.invoke('template:list'),
  listNodeLtsVersions: () => ipcRenderer.invoke('node:list-lts-versions'),
  runPrecheck: (payload) => ipcRenderer.invoke('task:precheck', payload),
  createTask: (payload) => ipcRenderer.invoke('task:create', payload),
  startTask: (taskId) => ipcRenderer.invoke('task:start', taskId),
  retryPlugin: (taskId, pluginId) => ipcRenderer.invoke('task:retry-plugin', { taskId, pluginId }),
  cleanupEnvironment: (detection) => ipcRenderer.invoke('environment:cleanup', detection),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pick-directory', { defaultPath }),
  importPluginFromPath: (pluginPath) => ipcRenderer.invoke('plugin:import', { path: pluginPath }),
}

contextBridge.exposeInMainWorld('envSetup', api)
