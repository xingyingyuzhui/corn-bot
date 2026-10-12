import type { RuntimeView } from '@corn-bot/contracts'
import type { ModelSettingsBridge } from '@corn-bot/contracts/model-settings'
import type {
  DataStatusView,
  WorkspaceBridge,
} from '@corn-bot/contracts/workspace'

declare global {
  interface Window {
    /** Narrow typed bridge from the sandboxed preload; absent outside Electron. */
    readonly corn?: {
      runtimeStatus(): Promise<RuntimeView>
      /** Absent on preloads that predate model settings. */
      readonly modelSettings?: ModelSettingsBridge
      /** Absent on preloads that predate the local data layer. */
      dataStatus?(): Promise<DataStatusView>
      /** Absent on preloads that predate the live workspace. */
      readonly workspace?: WorkspaceBridge
    }
  }
}
