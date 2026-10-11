import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld(
  'corn',
  Object.freeze({
    runtimeStatus: () => ipcRenderer.invoke('corn:runtime:status'),
  }),
)
