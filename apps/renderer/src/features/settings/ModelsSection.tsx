import type {
  CustomProviderFields,
  ModelProviderView,
  ModelSelection,
  ModelSettingsResult,
  ModelSettingsSnapshot,
} from '@corn-bot/contracts/model-settings'
import { LoaderCircle } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useModelSettingsPort } from '../../app/model-settings-context.tsx'
import { Button } from '../../shared/Button.tsx'
import { ToneIcon } from '../chat/ToneIcon.tsx'
import {
  addableProviders,
  type CustomProviderDraft,
  catalogModel,
  credentialLabel,
  type DefaultField,
  defaultModelOptions,
  draftFromProvider,
  type Editor,
  effortLabel,
  emptyCustomDraft,
  errorText,
  INITIAL_PAGE,
  KIND_LABELS,
  type ModelSettingsPageState,
  modelStatusText,
  modelStatusTone,
  type Operation,
  type PageNotice,
  pageReducer,
  providerActions,
  providerBadge,
  providerName,
  selectionFor,
  selectionValue,
  visibleProviders,
} from './model-settings-controller.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import { SettingsRow } from './SettingsRow.tsx'
import type { RowStatus } from './save-state.ts'

type Result = ModelSettingsResult<ModelSettingsSnapshot>

type Confirm = {
  readonly kind: 'clear' | 'remove'
  readonly providerId: string
}

const CUSTOM_CHOICE = 'custom:'
const routeChoice = (providerId: string) => `route:${providerId}`

const editorKey = (editor: Editor): string =>
  editor.kind === 'key'
    ? `key:${editor.providerId}`
    : editor.mode === 'create'
      ? 'custom:new'
      : `custom:${editor.providerId}`

const editorProvider = (editor: Editor | null): string | null =>
  editor === null || (editor.kind === 'custom' && editor.mode === 'create')
    ? null
    : editor.providerId

const STORAGE_NOTE =
  '密钥保存在 Corn 运行时目录中的本地凭据文件里，只有当前用户可读写。它不是系统钥匙串，同一用户运行的其他程序（包括 Agent 工具）仍可能读取。'

export function ModelsSection() {
  const port = useModelSettingsPort()
  const [state, dispatch] = useReducer(pageReducer, INITIAL_PAGE)
  const [draft, setDraft] = useState<CustomProviderDraft | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const tokens = useRef(0)
  const inFlight = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const hadEditor = useRef(false)

  const load = useCallback(async () => {
    tokens.current += 1
    const token = tokens.current
    dispatch({ type: 'load-start', token })
    const result = await port.read()
    dispatch(
      result.ok
        ? { type: 'load-success', token, snapshot: result.value }
        : { type: 'load-fail', token, error: result.error },
    )
  }, [port])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.reloadRequested) void load()
  }, [state.reloadRequested, load])

  useEffect(() => {
    const open = state.editor !== null
    if (hadEditor.current && !open && returnFocus.current?.isConnected)
      returnFocus.current.focus()
    hadEditor.current = open
  }, [state.editor])

  const run = async (
    op: Operation,
    call: (snapshot: ModelSettingsSnapshot) => Promise<Result>,
  ) => {
    const { snapshot } = state
    if (inFlight.current || !snapshot || state.busy || state.pending !== null)
      return
    inFlight.current = true
    tokens.current += 1
    const token = tokens.current
    dispatch({ type: 'op-start', token, op })
    try {
      const result = await call(snapshot)
      dispatch(
        result.ok
          ? { type: 'op-success', token, snapshot: result.value }
          : { type: 'op-fail', token, error: result.error },
      )
    } finally {
      inFlight.current = false
    }
  }

  const openEditor = (
    editor: Editor,
    custom: CustomProviderDraft | null,
    returnTo: HTMLElement | null = null,
  ) => {
    if (state.busy) return
    const active = document.activeElement
    returnFocus.current =
      returnTo ?? (active instanceof HTMLElement ? active : null)
    setConfirm(null)
    setDraft(custom)
    dispatch({ type: 'open-editor', editor })
  }

  const closeEditor = () => dispatch({ type: 'close-editor' })
  const editDraft = (next: CustomProviderDraft) => {
    setDraft(next)
    dispatch({ type: 'edit-draft' })
  }

  const submitKey = (providerId: string, key: string) =>
    void run({ kind: 'set-key', providerId }, (snapshot) => {
      const provider = snapshot.providers.find(
        (entry) => entry.id === providerId,
      )
      return port.setProviderKey({
        generation: snapshot.generation,
        providerId,
        revision: provider?.revision ?? 0,
        key,
      })
    })

  const submitCustom = (fields: CustomProviderFields, key: string) => {
    const editor = state.editor
    if (editor?.kind !== 'custom' || !draft) return
    if (editor.mode === 'create' && state.unconfirmedCreate) return void load()
    const providerId =
      editor.mode === 'create' ? draft.routeId.trim() : editor.providerId
    void run(
      { kind: 'save-custom', mode: editor.mode, providerId, fields },
      (snapshot) => {
        const revision =
          editor.mode === 'create'
            ? snapshot.customRevision
            : (snapshot.providers.find((entry) => entry.id === providerId)
                ?.revision ?? 0)
        const command = {
          generation: snapshot.generation,
          mode: editor.mode,
          providerId,
          revision,
          fields,
        }
        return port.saveCustomProvider(
          key.length > 0 ? { ...command, key } : command,
        )
      },
    )
  }

  const confirmAction = (
    provider: ModelProviderView,
    kind: Confirm['kind'],
  ) => {
    setConfirm(null)
    switch (kind) {
      case 'clear':
        return void run(
          { kind: 'clear-key', providerId: provider.id },
          (snapshot) =>
            port.clearProviderKey({
              generation: snapshot.generation,
              providerId: provider.id,
            }),
        )
      case 'remove':
        return void run(
          { kind: 'remove-custom', providerId: provider.id },
          (snapshot) =>
            port.removeCustomProvider({
              generation: snapshot.generation,
              providerId: provider.id,
              revision:
                snapshot.providers.find((entry) => entry.id === provider.id)
                  ?.revision ?? provider.revision,
            }),
        )
      default: {
        const unreachable: never = kind
        throw new Error(`Unknown confirmation ${String(unreachable)}`)
      }
    }
  }

  const saveDefault = (selection: ModelSelection, field: DefaultField) =>
    void run({ kind: 'set-default', selection, field }, (snapshot) =>
      port.setDefaultModel({
        generation: snapshot.generation,
        revision: snapshot.defaultRevision,
        selection,
      }),
    )

  const fixture =
    port.label === 'fixture' ? (
      <p className="corn-settings__warning" role="note">
        示例数据：未连接 Corn 运行时，保存不会写入真实配置。
      </p>
    ) : null

  const { snapshot } = state
  if (!snapshot)
    return (
      <>
        {fixture}
        <LoadState state={state} onRetry={() => void load()} />
      </>
    )

  const editor = state.editor
  const editorFor = (providerId: string | null) =>
    editor && editorProvider(editor) === providerId ? (
      <ProviderEditor
        key={editorKey(editor)}
        editor={editor}
        snapshot={snapshot}
        draft={draft}
        onDraft={editDraft}
        busy={
          state.busy?.kind === 'set-key' || state.busy?.kind === 'save-custom'
        }
        error={state.editorError}
        onSubmitKey={submitKey}
        onSubmitCustom={submitCustom}
        onClose={closeEditor}
      />
    ) : null
  const listed = visibleProviders(snapshot)
  const editingListed =
    editor !== null &&
    listed.some((provider) => provider.id === editorProvider(editor))

  return (
    <>
      {fixture}
      <p
        className="corn-model-settings__status"
        data-tone={modelStatusTone(snapshot.status)}
      >
        <ToneIcon tone={modelStatusTone(snapshot.status)} />
        {modelStatusText(snapshot.status)}
      </p>
      {snapshot.settingsWritable ? null : (
        <p className="corn-settings__warning" role="note">
          运行时的模型设置当前只读，不能在这里修改。
        </p>
      )}

      <h4 className="corn-settings__subheading">默认模型</h4>
      <DefaultModelCard
        snapshot={snapshot}
        busy={state.busy}
        notice={state.notice}
        disabled={!snapshot.settingsWritable || state.busy !== null}
        onSave={saveDefault}
      />

      <h4 className="corn-settings__subheading">提供方</h4>
      <PageNoticeLine notice={state.notice} />
      <ul className="corn-settings__card corn-provider-list">
        {listed.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            snapshot={snapshot}
            busy={state.busy}
            confirm={confirm?.providerId === provider.id ? confirm.kind : null}
            onConfirm={(kind) =>
              setConfirm(kind ? { kind, providerId: provider.id } : null)
            }
            onConfirmed={(kind) => confirmAction(provider, kind)}
            onEditKey={() =>
              openEditor({ kind: 'key', providerId: provider.id }, null)
            }
            onEditCustom={() =>
              openEditor(
                { kind: 'custom', mode: 'update', providerId: provider.id },
                draftFromProvider(provider),
              )
            }
          >
            {editorFor(provider.id)}
          </ProviderRow>
        ))}
      </ul>

      <AddProvider
        snapshot={snapshot}
        disabled={!snapshot.settingsWritable || state.busy !== null}
        onAdd={(choice, select) =>
          choice === CUSTOM_CHOICE
            ? openEditor(
                { kind: 'custom', mode: 'create' },
                emptyCustomDraft(snapshot),
                select,
              )
            : openEditor(
                {
                  kind: 'key',
                  providerId: choice.slice(routeChoice('').length),
                },
                null,
                select,
              )
        }
      >
        {editingListed ? null : editorFor(editorProvider(editor))}
      </AddProvider>

      {snapshot.catalogFailures > 0 ? (
        <p className="corn-settings__footnote">
          有 {snapshot.catalogFailures}{' '}
          个提供方的模型列表暂时无法读取，它们的模型不会出现在默认模型选择中。
        </p>
      ) : null}
      <p className="corn-settings__footnote">{STORAGE_NOTE}</p>
      <p className="corn-settings__footnote">
        本页读写的是 DSH 官方的设置服务和凭据服务，Corn
        不另存一份提供方、密钥或默认模型。 单个 Bot 可以在详情的「更多 →
        模型」里单独设置，覆盖这里的默认模型。
      </p>
    </>
  )
}

function LoadState({
  state,
  onRetry,
}: {
  readonly state: ModelSettingsPageState
  readonly onRetry: () => void
}) {
  switch (state.load) {
    case 'loading':
    case 'ready':
      return (
        <p className="corn-model-settings__state" aria-busy>
          <LoaderCircle
            className="corn-model-settings__spin"
            size={14}
            strokeWidth={2}
            aria-hidden
          />
          正在读取模型设置…
        </p>
      )
    case 'error':
      return (
        <div
          className="corn-model-settings__state"
          data-tone="error"
          role="alert"
        >
          <span>
            {state.error ? errorText(state.error) : '无法读取模型设置'}
          </span>
          <Button onClick={onRetry}>重试</Button>
        </div>
      )
    default: {
      const unreachable: never = state.load
      throw new Error(`Unknown load state ${String(unreachable)}`)
    }
  }
}

function PageNoticeLine({ notice }: { readonly notice: PageNotice | null }) {
  if (notice?.scope !== 'page') return null
  return (
    <p
      className="corn-model-settings__notice"
      data-tone={notice.tone}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.text}
    </p>
  )
}

function fieldStatus(
  field: DefaultField,
  busy: Operation | null,
  notice: PageNotice | null,
  readOnly: boolean,
): RowStatus {
  if (busy?.kind === 'set-default' && busy.field === field)
    return { kind: 'pending', text: '正在保存…' }
  if (notice?.scope === field)
    return notice.tone === 'ok'
      ? { kind: 'saved', text: notice.text }
      : { kind: 'failure', text: `保存失败：${notice.text}` }
  return readOnly
    ? { kind: 'unavailable', text: '运行时的模型设置当前只读' }
    : { kind: 'value' }
}

function DefaultModelCard({
  snapshot,
  busy,
  notice,
  disabled,
  onSave,
}: {
  readonly snapshot: ModelSettingsSnapshot
  readonly busy: Operation | null
  readonly notice: PageNotice | null
  readonly disabled: boolean
  readonly onSave: (selection: ModelSelection, field: DefaultField) => void
}) {
  const modelLabelId = useId()
  const modelId = useId()
  const effortLabelId = useId()
  const effortId = useId()
  const pending = busy?.kind === 'set-default' ? busy.selection : null
  const shown = pending ?? snapshot.defaultModel
  const value = shown ? selectionValue(shown.provider, shown.model) : ''
  const groups = defaultModelOptions(snapshot)
  const known = groups.some((group) =>
    group.options.some((option) => option.value === value),
  )
  const model = shown
    ? catalogModel(snapshot, shown.provider, shown.model)
    : null
  const efforts = model?.efforts ?? []
  const effort = shown?.reasoningEffort ?? model?.defaultEffort ?? efforts[0]
  const readOnly = !snapshot.settingsWritable

  return (
    <div className="corn-settings__card">
      <SettingsRow
        label="默认模型"
        labelId={modelLabelId}
        controlId={modelId}
        description="没有单独设置模型的 Bot 都用它。"
        status={fieldStatus('model', busy, notice, readOnly)}
      >
        <select
          id={modelId}
          className="corn-settings__select"
          value={value}
          disabled={disabled}
          aria-busy={pending ? true : undefined}
          onChange={(event) => {
            const selection = selectionFor(snapshot, event.target.value)
            if (selection) onSave(selection, 'model')
          }}
        >
          {known ? null : (
            <option value={value} disabled>
              {shown
                ? `${providerName(snapshot, shown.provider)} / ${shown.model}（不在当前目录中）`
                : '请选择模型'}
            </option>
          )}
          {groups.map((group) => (
            <optgroup key={group.providerId} label={group.label}>
              {group.options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </SettingsRow>
      {shown && efforts.length > 0 && effort !== undefined ? (
        <SettingsRow
          label="推理强度"
          labelId={effortLabelId}
          controlId={effortId}
          description="只对支持推理强度的模型生效。"
          status={fieldStatus('effort', busy, notice, readOnly)}
        >
          <select
            id={effortId}
            className="corn-settings__select"
            value={effort}
            disabled={disabled}
            onChange={(event) =>
              onSave(
                {
                  provider: shown.provider,
                  model: shown.model,
                  reasoningEffort: event.target.value,
                },
                'effort',
              )
            }
          >
            {efforts.map((entry) => (
              <option key={entry} value={entry}>
                {effortLabel(entry)}
              </option>
            ))}
          </select>
        </SettingsRow>
      ) : null}
    </div>
  )
}

function ProviderRow({
  provider,
  snapshot,
  busy,
  confirm,
  onConfirm,
  onConfirmed,
  onEditKey,
  onEditCustom,
  children,
}: {
  readonly provider: ModelProviderView
  readonly snapshot: ModelSettingsSnapshot
  readonly busy: Operation | null
  readonly confirm: Confirm['kind'] | null
  readonly onConfirm: (kind: Confirm['kind'] | null) => void
  readonly onConfirmed: (kind: Confirm['kind']) => void
  readonly onEditKey: () => void
  readonly onEditCustom: () => void
  readonly children: ReactNode
}) {
  const actions = providerActions(provider, snapshot)
  const badge = providerBadge(provider)
  const shared = provider.sharesKeyWith.map((id) => providerName(snapshot, id))
  const working =
    busy !== null && 'providerId' in busy && busy.providerId === provider.id
  const disabled = busy !== null
  return (
    <li className="corn-provider" data-provider-id={provider.id}>
      <div className="corn-provider__head">
        <div className="corn-provider__text">
          <span className="corn-provider__title">
            <span className="corn-provider__name">{provider.name}</span>
            <span className="corn-provider__tag">
              {KIND_LABELS[provider.kind]}
            </span>
          </span>
          <span className="corn-provider__meta">
            密钥：{credentialLabel(provider.credential)}
            {provider.custom ? ` · ${provider.custom.protocol}` : null}
          </span>
          {shared.length > 0 ? (
            <span className="corn-provider__warning">
              这个密钥同时用于 {shared.join('、')}
            </span>
          ) : null}
          {actions.readOnly ? (
            <span className="corn-provider__readonly">{actions.readOnly}</span>
          ) : null}
        </div>
        <span className="corn-provider__badge" data-tone={badge.tone}>
          {badge.text}
        </span>
      </div>
      {confirm ? (
        <div className="corn-provider__actions" data-confirm>
          <span className="corn-provider__confirm-text">
            {confirm === 'clear'
              ? shared.length > 0
                ? `清除后 ${shared.join('、')} 也会失去这个密钥。`
                : '清除后需要重新输入密钥才能使用。'
              : '删除这个提供方和它的模型列表？'}
          </span>
          <Button variant="ghost" onClick={() => onConfirm(null)}>
            取消
          </Button>
          <Button variant="danger" onClick={() => onConfirmed(confirm)}>
            {confirm === 'clear' ? '确认清除' : '确认删除'}
          </Button>
        </div>
      ) : (
        <ProviderButtons
          actions={actions}
          disabled={disabled}
          working={working}
          onEditKey={onEditKey}
          onEditCustom={onEditCustom}
          onConfirm={onConfirm}
        />
      )}
      {children}
    </li>
  )
}

function ProviderButtons({
  actions,
  disabled,
  working,
  onEditKey,
  onEditCustom,
  onConfirm,
}: {
  readonly actions: ReturnType<typeof providerActions>
  readonly disabled: boolean
  readonly working: boolean
  readonly onEditKey: () => void
  readonly onEditCustom: () => void
  readonly onConfirm: (kind: Confirm['kind']) => void
}) {
  const key = actions.setKey || actions.replaceKey
  if (!key && !actions.clearKey && !actions.edit && !actions.remove) return null
  return (
    <div className="corn-provider__actions" aria-busy={working || undefined}>
      {key ? (
        <Button key="key" disabled={disabled} onClick={onEditKey}>
          {actions.setKey ? '设置密钥' : '更换密钥'}
        </Button>
      ) : null}
      {actions.clearKey ? (
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => onConfirm('clear')}
        >
          清除密钥
        </Button>
      ) : null}
      {actions.edit ? (
        <Button variant="ghost" disabled={disabled} onClick={onEditCustom}>
          编辑
        </Button>
      ) : null}
      {actions.remove ? (
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => onConfirm('remove')}
        >
          删除
        </Button>
      ) : null}
    </div>
  )
}

function AddProvider({
  snapshot,
  disabled,
  onAdd,
  children,
}: {
  readonly snapshot: ModelSettingsSnapshot
  readonly disabled: boolean
  /** `select` takes focus back once the editor closes; the button may be gone. */
  readonly onAdd: (choice: string, select: HTMLSelectElement | null) => void
  readonly children: ReactNode
}) {
  const labelId = useId()
  const selectId = useId()
  const select = useRef<HTMLSelectElement>(null)
  const [choice, setChoice] = useState('')
  const addable = addableProviders(snapshot)
  const valid =
    choice === CUSTOM_CHOICE ||
    addable.some((provider) => routeChoice(provider.id) === choice)
  return (
    <div className="corn-settings__card corn-model-settings__add">
      <SettingsRow
        label="添加提供方"
        labelId={labelId}
        controlId={selectId}
        description="从运行时目录中选择，或声明一个兼容的自定义服务。"
        status={{ kind: 'value' }}
      >
        <span className="corn-model-settings__add-control">
          <select
            ref={select}
            id={selectId}
            className="corn-settings__select"
            value={valid ? choice : ''}
            disabled={disabled}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="" disabled>
              选择提供方…
            </option>
            {addable.length > 0 ? (
              <optgroup label="运行时目录">
                {addable.map((provider) => (
                  <option key={provider.id} value={routeChoice(provider.id)}>
                    {provider.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value={CUSTOM_CHOICE}>自定义提供方…</option>
          </select>
          <Button
            disabled={disabled || !valid}
            onClick={() => {
              if (!valid) return
              onAdd(choice, select.current)
              setChoice('')
            }}
          >
            添加
          </Button>
        </span>
      </SettingsRow>
      {children}
    </div>
  )
}
