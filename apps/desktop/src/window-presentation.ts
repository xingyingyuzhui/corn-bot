import type {
  App,
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron'

/**
 * `background` is for diagnostic smoke runs only: the window paints and can be
 * captured and driven, but never activates the app or takes keyboard focus
 * from whatever the user is doing.
 */
export type WindowPresentation = 'foreground' | 'background'

export function windowPresentation(
  env: Readonly<Record<string, string | undefined>>,
): WindowPresentation {
  return env.CORN_DESKTOP_SMOKE === '1' ? 'background' : 'foreground'
}

export function presentationWindowOptions(
  presentation: WindowPresentation,
): Pick<BrowserWindowConstructorOptions, 'show'> {
  switch (presentation) {
    case 'foreground':
      return {}
    case 'background':
      return { show: false }
    default: {
      const unhandled: never = presentation
      throw new Error(`Unknown window presentation: ${String(unhandled)}`)
    }
  }
}

export type PresentationApp = Pick<App, 'setActivationPolicy'>

/** Must run before the first window exists so macOS never activates the app. */
export function applyAppPresentation(
  host: PresentationApp,
  presentation: WindowPresentation,
  platform: NodeJS.Platform = process.platform,
): void {
  if (presentation === 'background' && platform === 'darwin')
    host.setActivationPolicy('accessory')
}

export type PresentedWindow = Pick<BrowserWindow, 'once' | 'showInactive'>

export function presentWindow(
  window: PresentedWindow,
  presentation: WindowPresentation,
): void {
  switch (presentation) {
    case 'foreground':
      return
    case 'background':
      window.once('ready-to-show', () => window.showInactive())
      return
    default: {
      const unhandled: never = presentation
      throw new Error(`Unknown window presentation: ${String(unhandled)}`)
    }
  }
}
