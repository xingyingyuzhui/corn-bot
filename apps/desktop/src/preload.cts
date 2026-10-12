import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preloads cannot load workspace modules; channel names are checked
// against MODEL_SETTINGS_CHANNELS and DATA_CHANNELS by
// apps/desktop/tests/model-settings-ipc.test.ts.
const call =
  (channel: string) =>
  (command?: unknown): Promise<unknown> =>
    command === undefined
      ? ipcRenderer.invoke(channel)
      : ipcRenderer.invoke(channel, command)

contextBridge.exposeInMainWorld(
  'corn',
  Object.freeze({
    runtimeStatus: () => ipcRenderer.invoke('corn:runtime:status'),
    dataStatus: () => ipcRenderer.invoke('corn:data:status'),
    modelSettings: Object.freeze({
      status: () => ipcRenderer.invoke('corn:model-settings:status'),
      read: () => ipcRenderer.invoke('corn:model-settings:read'),
      setProviderKey: call('corn:model-settings:set-key'),
      clearProviderKey: call('corn:model-settings:clear-key'),
      saveCustomProvider: call('corn:model-settings:save-provider'),
      removeCustomProvider: call('corn:model-settings:remove-provider'),
      setDefaultModel: call('corn:model-settings:set-default'),
    }),
  }),
)
