import { contextBridge, ipcRenderer } from 'electron'

import type { EnvSetupApi } from '../main/core/contracts'

const api: EnvSetupApi = {
  listTemplates: () => ipcRenderer.invoke('template:list'),
  listNodeLtsVersions: () => ipcRenderer.invoke('node:list-lts-versions'),
  runPrecheck: (payload) => ipcRenderer.invoke('task:precheck', payload),
  createTask: (payload) => ipcRenderer.invoke('task:create', payload),
  startTask: (taskId) => ipcRenderer.invoke('task:start', taskId),
  cancelTask: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  retryPlugin: (taskId, pluginId) => ipcRenderer.invoke('task:retry-plugin', { taskId, pluginId }),
  cleanupEnvironment: (detection) => ipcRenderer.invoke('environment:cleanup', detection),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pick-directory', { defaultPath }),
  importPluginFromPath: (pluginPath) => ipcRenderer.invoke('plugin:import', { path: pluginPath }),
  // 快照管理
  listSnapshots: () => ipcRenderer.invoke('snapshot:list'),
  createSnapshot: (payload) => ipcRenderer.invoke('snapshot:create', payload),
  deleteSnapshot: (snapshotId) => ipcRenderer.invoke('snapshot:delete', snapshotId),
  // 回滚
  suggestRollback: (payload) => ipcRenderer.invoke('rollback:suggest', payload),
  executeRollback: (payload) => ipcRenderer.invoke('rollback:execute', payload),
  // 增强预检
  runEnhancedPrecheck: (pluginResults) => ipcRenderer.invoke('precheck:enhanced', pluginResults),
}

contextBridge.exposeInMainWorld('envSetup', api)
