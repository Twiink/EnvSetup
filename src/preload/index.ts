import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('envSetup', {})
