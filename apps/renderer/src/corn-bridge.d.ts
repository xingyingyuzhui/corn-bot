import type { RuntimeView } from '@corn-bot/contracts'

declare global {
  interface Window {
    /** Narrow typed bridge from the sandboxed preload; absent outside Electron. */
    readonly corn?: {
      runtimeStatus(): Promise<RuntimeView>
    }
  }
}
