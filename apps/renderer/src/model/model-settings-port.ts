import type {
  ModelSettingsBridge,
  ModelSettingsResult,
  ModelStatusView,
} from '@corn-bot/contracts/model-settings'

export type ModelSettingsSource = 'fixture' | 'live'

/** The model-settings commands features call, labelled by data source. */
export interface ModelSettingsPort extends ModelSettingsBridge {
  readonly label: ModelSettingsSource
}

const HOST_ERROR = { ok: false, error: { code: 'host_error' } } as const

export const HOST_ERROR_STATUS: ModelStatusView = {
  status: 'unavailable',
  reason: 'host_error',
  devOverride: false,
}

/** A rejected or throwing call becomes a closed code; its text never reaches the UI. */
async function guarded<T>(
  call: () => Promise<ModelSettingsResult<T>>,
): Promise<ModelSettingsResult<T>> {
  try {
    return await call()
  } catch {
    return HOST_ERROR
  }
}

export function livePort(bridge: ModelSettingsBridge): ModelSettingsPort {
  return {
    label: 'live',
    async status() {
      try {
        return await bridge.status()
      } catch {
        return HOST_ERROR_STATUS
      }
    },
    read: () => guarded(() => bridge.read()),
    setProviderKey: (command) => guarded(() => bridge.setProviderKey(command)),
    clearProviderKey: (command) =>
      guarded(() => bridge.clearProviderKey(command)),
    saveCustomProvider: (command) =>
      guarded(() => bridge.saveCustomProvider(command)),
    removeCustomProvider: (command) =>
      guarded(() => bridge.removeCustomProvider(command)),
    setDefaultModel: (command) =>
      guarded(() => bridge.setDefaultModel(command)),
  }
}
