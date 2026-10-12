import type { RuntimeView } from '@corn-bot/contracts'
import type { ModelSettingsBridge } from '@corn-bot/contracts/model-settings'

declare global {
  interface Window {
    /** Narrow typed bridge from the sandboxed preload; absent outside Electron. */
    readonly corn?: {
      runtimeStatus(): Promise<RuntimeView>
      /** Absent on preloads that predate model settings. */
      readonly modelSettings?: ModelSettingsBridge
    }
  }
}
