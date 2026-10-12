import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  MODEL_SETTINGS_CHANNELS,
  type ModelSettingsResult,
  type ModelSettingsSnapshot,
} from '../../../../packages/contracts/src/model-settings.ts'
import {
  parseClearProviderKey,
  parseRemoveCustomProvider,
  parseSaveCustomProvider,
  parseSetDefaultModel,
  parseSetProviderKey,
} from '../model-settings/commands.ts'
import type { ModelSettingsService } from '../model-settings/service.ts'
import { assertTrustedSender } from '../security/ipc-allowlist.ts'

type Result = ModelSettingsResult<ModelSettingsSnapshot>
type Service = Pick<
  ModelSettingsService,
  | 'status'
  | 'read'
  | 'setProviderKey'
  | 'clearProviderKey'
  | 'saveCustomProvider'
  | 'removeCustomProvider'
  | 'setDefaultModel'
>

const INVALID: Result = { ok: false, error: { code: 'invalid_input' } }
const FAILED: Result = { ok: false, error: { code: 'host_error' } }

/**
 * Narrow model-settings IPC. Each channel names one Corn operation and takes
 * one structured payload; there is no namespace, ref, path or RPC passthrough.
 * Rejections never reach the Renderer: Electron would forward their message.
 */
export function registerModelSettingsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  window: BrowserWindow,
  service: Service,
): void {
  const command = <T>(
    channel: string,
    parse: (payload: unknown) => T | null,
    run: (command: T) => Promise<Result>,
  ) =>
    ipc.handle(
      channel,
      async (
        event: IpcMainInvokeEvent,
        payload: unknown,
        ...extra: unknown[]
      ) => {
        assertTrustedSender(event, window)
        const parsed = extra.length === 0 ? parse(payload) : null
        if (parsed === null) return INVALID
        try {
          return await run(parsed)
        } catch {
          return FAILED
        }
      },
    )
  const none = (payload: unknown) => (payload === undefined ? true : null)

  ipc.handle(MODEL_SETTINGS_CHANNELS.status, (event) => {
    assertTrustedSender(event, window)
    return service.status()
  })
  command(MODEL_SETTINGS_CHANNELS.read, none, () => service.read())
  command(MODEL_SETTINGS_CHANNELS.setProviderKey, parseSetProviderKey, (c) =>
    service.setProviderKey(c),
  )
  command(
    MODEL_SETTINGS_CHANNELS.clearProviderKey,
    parseClearProviderKey,
    (c) => service.clearProviderKey(c),
  )
  command(
    MODEL_SETTINGS_CHANNELS.saveCustomProvider,
    parseSaveCustomProvider,
    (c) => service.saveCustomProvider(c),
  )
  command(
    MODEL_SETTINGS_CHANNELS.removeCustomProvider,
    parseRemoveCustomProvider,
    (c) => service.removeCustomProvider(c),
  )
  command(MODEL_SETTINGS_CHANNELS.setDefaultModel, parseSetDefaultModel, (c) =>
    service.setDefaultModel(c),
  )
}
