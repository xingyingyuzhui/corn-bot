import {
  apiKeyProblem,
  type CatalogModelView,
  type CredentialState,
  CUSTOM_ROUTE_PATTERN,
  type CustomModelEntry,
  type CustomProviderFields,
  isHttpUrl,
  MAX_CUSTOM_MODELS,
  MAX_FIELD_LENGTH,
  type ModelProviderView,
  type ModelSelection,
  type ModelSettingsError,
  type ModelSettingsErrorCode,
  type ModelSettingsSnapshot,
  type ModelStatusReason,
  type ModelStatusView,
} from '@corn-bot/contracts/model-settings'

/* ── Wording ─────────────────────────────────────────────────────────── */

function codeText(code: ModelSettingsErrorCode): string {
  switch (code) {
    case 'runtime_unavailable':
      return '运行时尚未就绪，暂时无法读取或保存模型设置'
    case 'stale_generation':
      return '运行时已重新启动，已重新读取设置，请再试一次'
    case 'conflict':
      return '设置已被其他地方修改，已重新读取，请确认后再保存'
    case 'invalid_input':
      return '填写的内容不符合要求，请检查后再保存'
    case 'unknown_provider':
      return '找不到这个提供方，它可能已被移除'
    case 'unsupported_provider':
      return '这个提供方不支持在这里修改'
    case 'provider_exists':
      return '这个路由 ID 已被使用，请换一个'
    case 'model_not_in_catalog':
      return '所选模型不在当前可用目录中'
    case 'read_only':
      return '这项配置由启动环境或开发测试覆盖提供，只读，不能在这里修改'
    case 'rejected':
      return '运行时拒绝了这次修改'
    case 'outcome_unknown':
      return '保存结果未知，已重新读取当前状态，请确认后再操作'
    case 'partially_applied':
      return '修改只完成了一部分，已重新读取当前状态，请确认后再操作'
    case 'readback_mismatch':
      return '保存后读回的设置与提交的不一致，已重新读取，请确认当前设置'
    case 'host_error':
      return '运行时出错，没有完成这次操作'
    default: {
      const unreachable: never = code
      throw new Error(`Unknown model settings error ${String(unreachable)}`)
    }
  }
}

/** Closed codes only; raw Host text never reaches here. */
export function errorText(error: ModelSettingsError): string {
  if (error.code !== 'partially_applied') return codeText(error.code)
  const cause =
    error.cause === undefined || error.cause === 'partially_applied'
      ? '原因未知'
      : codeText(error.cause)
  switch (error.failedStep) {
    case 'credential':
      return `提供方配置已保存，密钥未保存：${cause}。请重新输入密钥再试`
    case 'provider':
      return `密钥已更新，提供方配置未保存：${cause}。请确认后再试`
    case undefined:
      return codeText(error.code)
    default: {
      const unreachable: never = error.failedStep
      throw new Error(`Unknown step ${String(unreachable)}`)
    }
  }
}

export function credentialLabel(state: CredentialState): string {
  switch (state.kind) {
    case 'missing':
      return '未配置'
    case 'not_required':
      return '无需密钥'
    case 'unknown':
      return '状态未知'
    case 'configured':
      switch (state.source) {
        case 'stored':
          return '已保存'
        case 'environment':
          return '由启动环境提供（只读）'
        case 'dev_override':
          return '开发测试覆盖（只读）'
        case 'home_env_file':
          return '由运行时目录的 .env 提供'
        case 'unknown':
          return '已配置'
        default: {
          const unreachable: never = state.source
          throw new Error(`Unknown credential source ${String(unreachable)}`)
        }
      }
    default: {
      const unreachable: never = state
      throw new Error(`Unknown credential state ${JSON.stringify(unreachable)}`)
    }
  }
}

const keyUsable = (state: CredentialState) =>
  state.kind === 'configured' || state.kind === 'not_required'

const credentialWritable = (state: CredentialState): boolean => {
  switch (state.kind) {
    case 'missing':
    case 'configured':
      return state.writable
    case 'not_required':
    case 'unknown':
      return false
    default: {
      const unreachable: never = state
      throw new Error(`Unknown credential state ${JSON.stringify(unreachable)}`)
    }
  }
}

export type BadgeTone = 'ok' | 'readonly' | 'error' | 'muted'

export interface ProviderBadge {
  readonly text: '可用' | '只读' | '不可用' | '未配置'
  readonly tone: BadgeTone
}

/** `可用` means configured and routable, not that a request has succeeded. */
export function providerBadge(provider: ModelProviderView): ProviderBadge {
  const { credential } = provider
  const usable = keyUsable(credential)
  if (provider.active && usable) return { text: '可用', tone: 'ok' }
  const keyLocked =
    (credential.kind === 'missing' || credential.kind === 'configured') &&
    !credential.writable
  if (!provider.settingsWritable || keyLocked)
    return { text: '只读', tone: 'readonly' }
  if (!provider.active && usable) return { text: '不可用', tone: 'error' }
  return { text: '未配置', tone: 'muted' }
}

export const KIND_LABELS: Readonly<Record<ModelProviderView['kind'], string>> =
  {
    builtin: '内置',
    catalog: '目录',
    custom: '自定义',
  }

export interface ProviderActions {
  readonly setKey: boolean
  readonly replaceKey: boolean
  readonly clearKey: boolean
  readonly edit: boolean
  readonly remove: boolean
  /** Why nothing (or only part) can be changed here, or `null`. */
  readonly readOnly: string | null
}

function readOnlyReason(
  provider: ModelProviderView,
  settingsWritable: boolean,
): string | null {
  const { credential } = provider
  if (credential.kind === 'configured' && !credential.writable)
    switch (credential.source) {
      case 'environment':
        return '密钥由启动环境提供，不能在这里修改'
      case 'dev_override':
        return '密钥由开发测试覆盖提供，不能在这里修改'
      case 'stored':
      case 'home_env_file':
      case 'unknown':
        return '密钥当前只读，不能在这里修改'
      default: {
        const unreachable: never = credential.source
        throw new Error(`Unknown credential source ${String(unreachable)}`)
      }
    }
  if (credential.kind === 'missing' && !credential.writable)
    return '密钥当前只读，不能在这里设置'
  if (!settingsWritable || !provider.settingsWritable)
    return '这个提供方的配置当前只读'
  return null
}

export function providerActions(
  provider: ModelProviderView,
  snapshot: Pick<ModelSettingsSnapshot, 'settingsWritable'>,
): ProviderActions {
  const settings = snapshot.settingsWritable && provider.settingsWritable
  const key = settings && credentialWritable(provider.credential)
  const custom = settings && provider.kind === 'custom'
  return {
    setKey: key && provider.credential.kind === 'missing',
    replaceKey: key && provider.credential.kind === 'configured',
    clearKey: key && provider.credential.kind === 'configured',
    edit: custom,
    remove: custom,
    readOnly: readOnlyReason(provider, snapshot.settingsWritable),
  }
}

function reasonText(reason: ModelStatusReason): string {
  switch (reason) {
    case 'runtime_not_ready':
      return '运行时尚未就绪，暂时无法检查模型配置'
    case 'reading':
      return '正在读取模型配置…'
    case 'no_default':
      return '模型未配置：尚未选择默认模型'
    case 'default_not_in_catalog':
      return '默认模型当前不在可用目录中，请重新选择'
    case 'provider_inactive':
      return '模型不可用：默认模型的提供方当前未启用'
    case 'credential_missing':
      return '模型未配置：默认模型的提供方还没有密钥'
    case 'configured':
      return '模型配置当前不可用'
    case 'host_error':
      return '无法读取模型配置'
    default: {
      const unreachable: never = reason
      throw new Error(`Unknown model status reason ${String(unreachable)}`)
    }
  }
}

export function modelStatusText(view: ModelStatusView): string {
  const text = (() => {
    switch (view.status) {
      case 'checking':
        return '正在检查模型配置…'
      case 'available':
        return '模型已配置（首次发送时才会真正连接服务商）'
      case 'needs_configuration':
      case 'unavailable':
        return reasonText(view.reason)
      default: {
        const unreachable: never = view.status
        throw new Error(`Unknown model status ${String(unreachable)}`)
      }
    }
  })()
  return view.devOverride ? `${text}（开发测试覆盖生效中）` : text
}

export type ModelStatusTone = 'busy' | 'ok' | 'muted' | 'error'

export function modelStatusTone(view: ModelStatusView): ModelStatusTone {
  switch (view.status) {
    case 'checking':
      return 'busy'
    case 'available':
      return 'ok'
    case 'needs_configuration':
      return 'muted'
    case 'unavailable':
      return 'error'
    default: {
      const unreachable: never = view.status
      throw new Error(`Unknown model status ${String(unreachable)}`)
    }
  }
}

const EFFORT_LABELS: Readonly<Record<string, string>> = {
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
}

export const effortLabel = (effort: string): string =>
  EFFORT_LABELS[effort] ?? effort

/* ── Provider lists and default-model options ────────────────────────── */

const shownInList = (provider: ModelProviderView) =>
  provider.kind !== 'catalog' ||
  provider.configured ||
  provider.credential.kind === 'configured'

export function visibleProviders(
  snapshot: ModelSettingsSnapshot,
): readonly ModelProviderView[] {
  return snapshot.providers.filter(shownInList)
}

export function addableProviders(
  snapshot: ModelSettingsSnapshot,
): readonly ModelProviderView[] {
  return snapshot.providers.filter((provider) => !shownInList(provider))
}

export function providerName(
  snapshot: ModelSettingsSnapshot,
  providerId: string,
): string {
  return (
    snapshot.providers.find((provider) => provider.id === providerId)?.name ??
    providerId
  )
}

export interface DefaultModelOption {
  readonly value: string
  readonly label: string
  readonly disabled: boolean
}

export interface DefaultModelGroup {
  readonly providerId: string
  readonly label: string
  readonly options: readonly DefaultModelOption[]
}

/** Option value for a provider/model pair; unambiguous for any ids. */
export const selectionValue = (provider: string, model: string): string =>
  JSON.stringify([provider, model])

export function defaultModelOptions(
  snapshot: ModelSettingsSnapshot,
): readonly DefaultModelGroup[] {
  return snapshot.catalog.map((group) => {
    const provider = snapshot.providers.find(
      (entry) => entry.id === group.providerId,
    )
    const active = provider?.active === true
    const keyMissing = provider?.credential.kind === 'missing'
    return {
      providerId: group.providerId,
      label: group.providerName,
      options: group.models.map((model) => ({
        value: selectionValue(group.providerId, model.id),
        label: keyMissing ? `${model.name}（需要先配置密钥）` : model.name,
        disabled: !active,
      })),
    }
  })
}

export function catalogModel(
  snapshot: ModelSettingsSnapshot,
  provider: string,
  model: string,
): CatalogModelView | null {
  return (
    snapshot.catalog
      .find((group) => group.providerId === provider)
      ?.models.find((entry) => entry.id === model) ?? null
  )
}

/** The selection for `value` with the model's default effort, or `null`. */
export function selectionFor(
  snapshot: ModelSettingsSnapshot,
  value: string,
): ModelSelection | null {
  for (const group of snapshot.catalog)
    for (const model of group.models)
      if (selectionValue(group.providerId, model.id) === value) {
        const effort = model.defaultEffort ?? model.efforts[0]
        return effort === undefined
          ? { provider: group.providerId, model: model.id }
          : {
              provider: group.providerId,
              model: model.id,
              reasoningEffort: effort,
            }
      }
  return null
}

/* ── Form validation ─────────────────────────────────────────────────── */

export function keyError(raw: string): string | null {
  const problem = apiKeyProblem(raw.trim())
  switch (problem) {
    case null:
      return null
    case 'blank':
      return raw.length > 0 ? '密钥不能只包含空白' : '请输入密钥'
    case 'format':
      return '密钥格式不正确，请重新粘贴'
    case 'too_long':
      return '密钥过长'
    default: {
      const unreachable: never = problem
      throw new Error(`Unknown key problem ${String(unreachable)}`)
    }
  }
}

export interface ModelRowDraft {
  /** Stable list key for the form row; never sent. */
  readonly rowKey: number
  readonly id: string
  readonly name: string
}

export interface CustomProviderDraft {
  readonly routeId: string
  readonly displayName: string
  readonly protocol: string
  readonly baseURL: string
  readonly models: readonly ModelRowDraft[]
}

export type CustomField =
  | 'routeId'
  | 'displayName'
  | 'protocol'
  | 'baseURL'
  | 'models'

export type CustomErrors = Partial<Record<CustomField, string>>

export function emptyCustomDraft(
  snapshot: Pick<ModelSettingsSnapshot, 'protocols'>,
): CustomProviderDraft {
  return {
    routeId: '',
    displayName: '',
    protocol: snapshot.protocols[0] ?? '',
    baseURL: '',
    models: [{ rowKey: 0, id: '', name: '' }],
  }
}

export function draftFromProvider(
  provider: ModelProviderView,
): CustomProviderDraft | null {
  const { custom } = provider
  if (!custom) return null
  return {
    routeId: provider.id,
    displayName: custom.displayName,
    protocol: custom.protocol,
    baseURL: custom.baseURL,
    models: custom.models.map((model, rowKey) => ({
      rowKey,
      id: model.id,
      name: model.name ?? '',
    })),
  }
}

function routeIdError(
  routeId: string,
  snapshot: ModelSettingsSnapshot,
): string | null {
  if (routeId.length === 0) return '请填写路由 ID'
  if (routeId.length > MAX_FIELD_LENGTH)
    return `路由 ID 不能超过 ${MAX_FIELD_LENGTH} 个字符`
  if (!CUSTOM_ROUTE_PATTERN.test(routeId))
    return '路由 ID 只能用小写字母、数字和单个连字符，并以字母开头'
  const taken =
    snapshot.providers.some((provider) => provider.id === routeId) ||
    snapshot.catalog.some((group) => group.providerId === routeId)
  return taken ? '这个路由 ID 已被使用' : null
}

function modelsError(
  rows: readonly ModelRowDraft[],
): { readonly error: string } | { readonly models: CustomModelEntry[] } {
  const models: CustomModelEntry[] = []
  for (const row of rows) {
    const id = row.id.trim()
    const name = row.name.trim()
    if (id.length === 0 && name.length === 0) continue
    if (id.length === 0) return { error: '模型 ID 不能为空' }
    if (id.length > MAX_FIELD_LENGTH || name.length > MAX_FIELD_LENGTH)
      return { error: `模型 ID 和名称不能超过 ${MAX_FIELD_LENGTH} 个字符` }
    if (models.some((model) => model.id === id))
      return { error: `模型 ID 不能重复：${id}` }
    models.push(name.length > 0 ? { id, name } : { id })
  }
  if (models.length === 0) return { error: '至少添加一个模型' }
  if (models.length > MAX_CUSTOM_MODELS)
    return { error: `最多添加 ${MAX_CUSTOM_MODELS} 个模型` }
  return { models }
}

export type CustomValidation =
  | { readonly ok: true; readonly fields: CustomProviderFields }
  | { readonly ok: false; readonly errors: CustomErrors }

export function validateCustomDraft(
  draft: CustomProviderDraft,
  snapshot: ModelSettingsSnapshot,
  mode: 'create' | 'update',
): CustomValidation {
  const errors: Partial<Record<CustomField, string>> = {}
  const routeId = draft.routeId.trim()
  const displayName = draft.displayName.trim()
  const baseURL = draft.baseURL.trim()
  if (mode === 'create') {
    const routeProblem = routeIdError(routeId, snapshot)
    if (routeProblem) errors.routeId = routeProblem
  }
  if (displayName.length === 0) errors.displayName = '请填写显示名称'
  else if (displayName.length > MAX_FIELD_LENGTH)
    errors.displayName = `显示名称不能超过 ${MAX_FIELD_LENGTH} 个字符`
  if (!snapshot.protocols.includes(draft.protocol))
    errors.protocol = '请选择运行时支持的协议'
  if (!isHttpUrl(baseURL))
    errors.baseURL = '请填写以 http:// 或 https:// 开头、不含账号密码的地址'
  const models = modelsError(draft.models)
  if ('error' in models) errors.models = models.error
  if (Object.keys(errors).length > 0 || 'error' in models)
    return { ok: false, errors }
  return {
    ok: true,
    fields: {
      displayName,
      protocol: draft.protocol,
      baseURL,
      models: models.models,
    },
  }
}

/* ── Page state ──────────────────────────────────────────────────────── */

export type Editor =
  | { readonly kind: 'key'; readonly providerId: string }
  | { readonly kind: 'custom'; readonly mode: 'create' }
  | {
      readonly kind: 'custom'
      readonly mode: 'update'
      readonly providerId: string
    }

export type Operation =
  | { readonly kind: 'set-key'; readonly providerId: string }
  | { readonly kind: 'clear-key'; readonly providerId: string }
  | {
      readonly kind: 'save-custom'
      readonly mode: 'create' | 'update'
      readonly providerId: string
    }
  | { readonly kind: 'remove-custom'; readonly providerId: string }
  | {
      readonly kind: 'set-default'
      readonly selection: ModelSelection
      /** The row that started the change, which shows its result. */
      readonly field: DefaultField
    }

export type DefaultField = 'model' | 'effort'

export interface PageNotice {
  readonly tone: 'ok' | 'error'
  readonly text: string
  /** A default-model field's own status line, or the page. */
  readonly scope: 'page' | DefaultField
}

export interface ModelSettingsPageState {
  readonly load: 'loading' | 'ready' | 'error'
  readonly snapshot: ModelSettingsSnapshot | null
  /** Why the first read failed; shown with a retry. */
  readonly error: ModelSettingsError | null
  readonly busy: Operation | null
  readonly notice: PageNotice | null
  readonly editor: Editor | null
  /** The last editor submit failed; non-secret fields stay as typed. */
  readonly editorError: string | null
  /** The read or write whose result is still awaited. */
  readonly pending: number | null
  /** A failure left the page unsure of the Host's state. */
  readonly reloadRequested: boolean
}

export const INITIAL_PAGE: ModelSettingsPageState = {
  load: 'loading',
  snapshot: null,
  error: null,
  busy: null,
  notice: null,
  editor: null,
  editorError: null,
  pending: null,
  reloadRequested: false,
}

export type PageAction =
  | { readonly type: 'load-start'; readonly token: number }
  | {
      readonly type: 'load-success'
      readonly token: number
      readonly snapshot: ModelSettingsSnapshot
    }
  | {
      readonly type: 'load-fail'
      readonly token: number
      readonly error: ModelSettingsError
    }
  | {
      readonly type: 'op-start'
      readonly token: number
      readonly op: Operation
    }
  | {
      readonly type: 'op-success'
      readonly token: number
      readonly snapshot: ModelSettingsSnapshot
    }
  | {
      readonly type: 'op-fail'
      readonly token: number
      readonly error: ModelSettingsError
    }
  | { readonly type: 'open-editor'; readonly editor: Editor }
  | { readonly type: 'close-editor' }
  | { readonly type: 'dismiss-notice' }

/** Outcomes the page cannot trust without a fresh read from Main. */
const RELOAD_CODES: ReadonlySet<ModelSettingsErrorCode> = new Set([
  'stale_generation',
  'conflict',
  'outcome_unknown',
  'partially_applied',
  'readback_mismatch',
])

function successText(op: Operation): string {
  switch (op.kind) {
    case 'set-key':
      return '密钥已保存（尚未验证能否连接服务商）'
    case 'clear-key':
      return '密钥已清除'
    case 'save-custom':
      return op.mode === 'create' ? '提供方已添加' : '提供方已更新'
    case 'remove-custom':
      return '提供方已删除'
    case 'set-default':
      return '已保存'
    default: {
      const unreachable: never = op
      throw new Error(`Unknown operation ${JSON.stringify(unreachable)}`)
    }
  }
}

const usesEditor = (op: Operation): boolean =>
  op.kind === 'set-key' || op.kind === 'save-custom'

const scopeOf = (op: Operation): PageNotice['scope'] =>
  op.kind === 'set-default' ? op.field : 'page'

/** After a partial create the route exists, so the editor continues as an update. */
function editorAfterFailure(
  editor: Editor | null,
  op: Operation,
  error: ModelSettingsError,
): Editor | null {
  if (
    editor?.kind === 'custom' &&
    editor.mode === 'create' &&
    op.kind === 'save-custom' &&
    error.code === 'partially_applied' &&
    error.failedStep === 'credential'
  )
    return { kind: 'custom', mode: 'update', providerId: op.providerId }
  return editor
}

export function pageReducer(
  state: ModelSettingsPageState,
  action: PageAction,
): ModelSettingsPageState {
  switch (action.type) {
    case 'load-start':
      return {
        ...state,
        load: state.snapshot ? state.load : 'loading',
        busy: null,
        pending: action.token,
        reloadRequested: false,
      }
    case 'load-success':
      return action.token !== state.pending
        ? state
        : {
            ...state,
            load: 'ready',
            snapshot: action.snapshot,
            error: null,
            pending: null,
          }
    case 'load-fail':
      if (action.token !== state.pending) return state
      return state.snapshot
        ? {
            ...state,
            pending: null,
            notice: {
              tone: 'error',
              text: errorText(action.error),
              scope: 'page',
            },
          }
        : { ...state, load: 'error', error: action.error, pending: null }
    case 'op-start':
      if (state.busy || state.pending !== null || !state.snapshot) return state
      return {
        ...state,
        busy: action.op,
        pending: action.token,
        notice: null,
        editorError: null,
      }
    case 'op-success': {
      const op = state.busy
      if (action.token !== state.pending || !op) return state
      return {
        ...state,
        snapshot: action.snapshot,
        busy: null,
        pending: null,
        editor: usesEditor(op) ? null : state.editor,
        editorError: null,
        notice: { tone: 'ok', text: successText(op), scope: scopeOf(op) },
      }
    }
    case 'op-fail': {
      const op = state.busy
      if (action.token !== state.pending || !op) return state
      const text = errorText(action.error)
      const inEditor = usesEditor(op) && state.editor !== null
      return {
        ...state,
        snapshot: action.error.snapshot ?? state.snapshot,
        busy: null,
        pending: null,
        editor: editorAfterFailure(state.editor, op, action.error),
        editorError: inEditor ? text : null,
        notice: inEditor ? null : { tone: 'error', text, scope: scopeOf(op) },
        reloadRequested:
          action.error.snapshot === undefined &&
          RELOAD_CODES.has(action.error.code),
      }
    }
    case 'open-editor':
      return state.busy
        ? state
        : { ...state, editor: action.editor, editorError: null, notice: null }
    case 'close-editor':
      return state.busy || state.editor === null
        ? state
        : { ...state, editor: null, editorError: null }
    case 'dismiss-notice':
      return state.notice ? { ...state, notice: null } : state
    default: {
      const unreachable: never = action
      throw new Error(`Unknown page action ${JSON.stringify(unreachable)}`)
    }
  }
}
