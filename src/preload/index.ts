import { contextBridge, ipcRenderer } from 'electron'

import type { EnvSetupApi, TaskProgressEvent } from '../main/core/contracts'

let taskProgressListener: ((event: TaskProgressEvent) => void) | undefined

const api: EnvSetupApi = {
  loadBootstrap: () => ipcRenderer.invoke('bootstrap:load'),
  listTemplates: () => ipcRenderer.invoke('template:list'),
  listNodeLtsVersions: () => ipcRenderer.invoke('node:list-lts-versions'),
  listJavaLtsVersions: () => ipcRenderer.invoke('java:list-lts-versions'),
  listPythonVersions: () => ipcRenderer.invoke('python:list-versions'),
  listGitVersions: () => ipcRenderer.invoke('git:list-versions'),
  runPrecheck: (payload) => ipcRenderer.invoke('task:precheck', payload),
  createTask: (payload) => ipcRenderer.invoke('task:create', payload),
  startTask: (taskId) => ipcRenderer.invoke('task:start', taskId),
  cancelTask: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  retryPlugin: (taskId, pluginId) => ipcRenderer.invoke('task:retry-plugin', { taskId, pluginId }),
  cleanupEnvironment: (detection) => ipcRenderer.invoke('environment:cleanup', detection),
  cleanupEnvironments: (detections) => ipcRenderer.invoke('environment:cleanup-batch', detections),
  pickDirectory: (defaultPath) => ipcRenderer.invoke('dialog:pick-directory', { defaultPath }),
  importPluginFromPath: (pluginPath) => ipcRenderer.invoke('plugin:import', { path: pluginPath }),
  previewEnvChanges: (changes) => ipcRenderer.invoke('environment:preview-changes', changes),
  applyEnvChanges: (payload) => ipcRenderer.invoke('environment:apply-changes', payload),
  // 快照管理
  listSnapshots: () => ipcRenderer.invoke('snapshot:list'),
  createSnapshot: (payload) => ipcRenderer.invoke('snapshot:create', payload),
  deleteSnapshot: (snapshotId) => ipcRenderer.invoke('snapshot:delete', snapshotId),
  // 回滚
  suggestRollback: (payload) => ipcRenderer.invoke('rollback:suggest', payload),
  executeRollback: (payload) => ipcRenderer.invoke('rollback:execute', payload),
  // 增强预检
  runEnhancedPrecheck: (pluginResults) => ipcRenderer.invoke('precheck:enhanced', pluginResults),
  onTaskProgress: (callback) => {
    taskProgressListener = callback
    ipcRenderer.on('task:progress', (_event, data: TaskProgressEvent) => {
      taskProgressListener?.(data)
    })
  },
  removeTaskProgressListener: () => {
    taskProgressListener = undefined
    ipcRenderer.removeAllListeners('task:progress')
  },
}

contextBridge.exposeInMainWorld('envSetup', api)
