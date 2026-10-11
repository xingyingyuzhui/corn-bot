/**
 * Save lifecycle for one settings row. The committed value lives in the
 * workspace snapshot; this only tracks the attempt to change it, so a failure
 * never overwrites what is actually in effect.
 */
export type SaveState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'saving'; readonly target: T }
  | { readonly status: 'saved' }
  | {
      readonly status: 'error'
      readonly target: T
      readonly message: string
    }

export type SaveAction<T> =
  | { readonly type: 'start'; readonly target: T }
  | { readonly type: 'succeed' }
  | { readonly type: 'fail'; readonly message: string }
  | { readonly type: 'dismiss' }

export function saveReducer<T>(
  state: SaveState<T>,
  action: SaveAction<T>,
): SaveState<T> {
  switch (action.type) {
    case 'start':
      return state.status === 'saving'
        ? state
        : { status: 'saving', target: action.target }
    case 'succeed':
      return state.status === 'saving' ? { status: 'saved' } : state
    case 'fail':
      return state.status === 'saving'
        ? { status: 'error', target: state.target, message: action.message }
        : state
    case 'dismiss':
      return state.status === 'saving' ? state : { status: 'idle' }
    default: {
      const unreachable: never = action
      throw new Error(`Unknown save action ${JSON.stringify(unreachable)}`)
    }
  }
}

/** The value a control shows: the in-flight target, else what is in effect. */
export function displayedValue<T>(state: SaveState<T>, committed: T): T {
  return state.status === 'saving' ? state.target : committed
}

export type RowStatus =
  | { readonly kind: 'value' }
  | { readonly kind: 'pending'; readonly text: string }
  | { readonly kind: 'saved'; readonly text: string }
  | { readonly kind: 'failure'; readonly text: string }
  | { readonly kind: 'unavailable'; readonly text: string }

/**
 * One status line per row. Unavailable (not shipped or policy-disabled) wins
 * over save state because the row cannot be changed at all.
 */
export function rowStatus<T>(
  state: SaveState<T>,
  unavailable?: string,
): RowStatus {
  if (unavailable) return { kind: 'unavailable', text: unavailable }
  switch (state.status) {
    case 'idle':
      return { kind: 'value' }
    case 'saving':
      return { kind: 'pending', text: '正在保存…' }
    case 'saved':
      return { kind: 'saved', text: '已保存' }
    case 'error':
      return { kind: 'failure', text: `保存失败：${state.message}` }
    default: {
      const unreachable: never = state
      throw new Error(`Unknown save state ${JSON.stringify(unreachable)}`)
    }
  }
}
