import type {
  CustomProviderFields,
  ModelSettingsSnapshot,
} from '@corn-bot/contracts/model-settings'
import { Plus, X } from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Button } from '../../shared/Button.tsx'
import { TextField } from '../../shared/TextField.tsx'
import {
  type CustomErrors,
  type CustomProviderDraft,
  type Editor,
  keyError,
  type ModelRowDraft,
  providerName,
  validateCustomDraft,
} from './model-settings-controller.ts'

export interface ProviderEditorProps {
  readonly editor: Editor
  readonly snapshot: ModelSettingsSnapshot
  /** The custom-provider form; owned by the page so a remount keeps it. */
  readonly draft: CustomProviderDraft | null
  readonly onDraft: (draft: CustomProviderDraft) => void
  readonly busy: boolean
  /** The last submit failed with this text. */
  readonly error: string | null
  readonly onSubmitKey: (providerId: string, key: string) => void
  readonly onSubmitCustom: (fields: CustomProviderFields, key: string) => void
  readonly onClose: () => void
}

/**
 * Inline panel inside the settings dialog, never a nested modal. Escape closes
 * only this panel. The key lives in the password input alone: it is read at
 * submit and wiped right after, on close and on unmount.
 */
export function ProviderEditor(props: ProviderEditorProps) {
  const { editor, busy, onClose } = props
  const panel = useRef<HTMLFormElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const [keyProblem, setKeyProblem] = useState<string | null>(null)
  const [keySent, setKeySent] = useState(false)
  const [errors, setErrors] = useState<CustomErrors>({})

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, select')?.focus()
  }, [])

  useEffect(() => {
    const input = keyInput.current
    return () => {
      if (input) input.value = ''
    }
  }, [])

  // Submitting disables the button and drops focus; land it on what to fix.
  useEffect(() => {
    if (!props.error) return
    const form = panel.current
    form
      ?.querySelector<HTMLElement>('[aria-invalid="true"], input, select')
      ?.focus()
  }, [props.error])

  /** Reads and wipes the field in one step; the value only travels onward. */
  const takeKey = (): string => {
    const input = keyInput.current
    if (!input) return ''
    const key = input.value
    input.value = ''
    return key
  }

  const close = () => {
    if (busy) return
    takeKey()
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const key = takeKey()
    switch (editor.kind) {
      case 'key': {
        const problem = keyError(key)
        setKeyProblem(problem)
        setKeySent(problem === null)
        if (problem === null) props.onSubmitKey(editor.providerId, key.trim())
        else keyInput.current?.focus()
        return
      }
      case 'custom': {
        if (!props.draft) return
        const typed = key.trim()
        const problem = typed.length > 0 ? keyError(key) : null
        const validation = validateCustomDraft(
          props.draft,
          props.snapshot,
          editor.mode,
        )
        setKeyProblem(problem)
        setErrors(validation.ok ? {} : validation.errors)
        setKeySent(typed.length > 0 && problem === null)
        if (validation.ok && problem === null)
          props.onSubmitCustom(validation.fields, typed)
        return
      }
      default: {
        const unreachable: never = editor
        throw new Error(`Unknown editor ${JSON.stringify(unreachable)}`)
      }
    }
  }

  const name =
    editor.kind === 'custom' && editor.mode === 'create'
      ? null
      : providerName(props.snapshot, editor.providerId)
  const configured =
    editor.kind === 'key' &&
    props.snapshot.providers.find(
      (provider) => provider.id === editor.providerId,
    )?.credential.kind === 'configured'
  const title =
    editor.kind === 'key'
      ? configured
        ? `更换 ${name} 的密钥`
        : `为 ${name} 设置密钥`
      : name === null
        ? '添加自定义提供方'
        : `编辑 ${name}`
  const retypeKey = props.error !== null && keySent

  return (
    <form
      ref={panel}
      className="corn-provider-editor"
      aria-label={title}
      onKeyDown={onKeyDown}
      onSubmit={submit}
      noValidate
    >
      <p className="corn-provider-editor__title">{title}</p>
      {/* While a save is in flight nothing in the editor can change. */}
      <fieldset className="corn-provider-editor__fields" disabled={busy}>
        {props.error ? (
          <p className="corn-provider-editor__error" role="alert">
            {props.error}
          </p>
        ) : null}
        {editor.kind === 'custom' && props.draft ? (
          <CustomFields
            draft={props.draft}
            onDraft={props.onDraft}
            errors={errors}
            protocols={props.snapshot.protocols}
            create={editor.mode === 'create'}
          />
        ) : null}
        <KeyField
          inputRef={keyInput}
          optional={editor.kind === 'custom'}
          error={keyProblem ?? (retypeKey ? '请重新输入密钥' : null)}
          hint={keyHint(editor, configured)}
        />
        <div className="corn-provider-editor__actions">
          <Button variant="ghost" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button variant="primary" type="submit" pending={busy}>
            {busy ? '正在保存…' : '保存'}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}

function keyHint(editor: Editor, configured: boolean): string {
  switch (editor.kind) {
    case 'key':
      return configured
        ? '不会显示已保存的密钥；保存后会替换它。保存成功不代表已验证能连接服务商。'
        : '保存成功不代表已验证能连接服务商，首次发送时才会真正连接。'
    case 'custom':
      return editor.mode === 'create'
        ? '可留空，之后再设置。'
        : '留空则保留已保存的密钥。'
    default: {
      const unreachable: never = editor
      throw new Error(`Unknown editor ${JSON.stringify(unreachable)}`)
    }
  }
}

function KeyField({
  inputRef,
  optional,
  error,
  hint,
}: {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly optional: boolean
  readonly error: string | null
  readonly hint: string
}) {
  const id = useId()
  const messageId = useId()
  return (
    <div className="corn-field" data-invalid={error ? true : undefined}>
      <label htmlFor={id} className="corn-field__label">
        {optional ? '密钥（API Key，可选）' : '密钥（API Key）'}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="corn-field__input corn-provider-editor__key"
        aria-invalid={error ? true : undefined}
        aria-describedby={messageId}
      />
      <p
        id={messageId}
        className="corn-field__message"
        role={error ? 'alert' : undefined}
      >
        {error ?? hint}
      </p>
    </div>
  )
}

function CustomFields({
  draft,
  onDraft,
  errors,
  protocols,
  create,
}: {
  readonly draft: CustomProviderDraft
  readonly onDraft: (draft: CustomProviderDraft) => void
  readonly errors: CustomErrors
  readonly protocols: readonly string[]
  readonly create: boolean
}) {
  const protocolId = useId()
  const protocolMessageId = useId()
  const modelsId = useId()
  const modelsMessageId = useId()
  const nextRow = useRef(
    Math.max(0, ...draft.models.map((row) => row.rowKey)) + 1,
  )
  const patch = (next: Partial<CustomProviderDraft>) =>
    onDraft({ ...draft, ...next })
  const editRow = (rowKey: number, next: Partial<ModelRowDraft>) =>
    patch({
      models: draft.models.map((row) =>
        row.rowKey === rowKey ? { ...row, ...next } : row,
      ),
    })

  return (
    <>
      {create ? (
        <TextField
          label="路由 ID"
          value={draft.routeId}
          onChange={(routeId) => patch({ routeId })}
          error={errors.routeId ?? null}
          hint="小写字母开头，可含数字和连字符，例如 my-gateway。创建后不能修改。"
          required
        />
      ) : null}
      <TextField
        label="显示名称"
        value={draft.displayName}
        onChange={(displayName) => patch({ displayName })}
        error={errors.displayName ?? null}
        required
      />
      <div
        className="corn-field"
        data-invalid={errors.protocol ? true : undefined}
      >
        <label htmlFor={protocolId} className="corn-field__label">
          协议
        </label>
        <select
          id={protocolId}
          className="corn-field__input"
          value={draft.protocol}
          aria-invalid={errors.protocol ? true : undefined}
          aria-describedby={errors.protocol ? protocolMessageId : undefined}
          onChange={(event) => patch({ protocol: event.target.value })}
        >
          {protocols.includes(draft.protocol) ? null : (
            <option value={draft.protocol} disabled>
              {draft.protocol || '请选择协议'}
            </option>
          )}
          {protocols.map((protocol) => (
            <option key={protocol} value={protocol}>
              {protocol}
            </option>
          ))}
        </select>
        {errors.protocol ? (
          <p
            id={protocolMessageId}
            className="corn-field__message"
            role="alert"
          >
            {errors.protocol}
          </p>
        ) : null}
      </div>
      <TextField
        label="接口地址（Base URL）"
        value={draft.baseURL}
        onChange={(baseURL) => patch({ baseURL })}
        error={errors.baseURL ?? null}
        placeholder="https://api.example.com/v1"
        required
      />
      <fieldset
        className="corn-field corn-provider-editor__models"
        data-invalid={errors.models ? true : undefined}
        aria-describedby={errors.models ? modelsMessageId : undefined}
      >
        <legend id={modelsId} className="corn-field__label">
          模型（ID 必填，名称可选）
        </legend>
        {draft.models.map((row, index) => (
          <div key={row.rowKey} className="corn-provider-editor__model-row">
            <input
              className="corn-field__input"
              value={row.id}
              placeholder="模型 ID"
              aria-label={`第 ${index + 1} 个模型的 ID`}
              spellCheck={false}
              onChange={(event) =>
                editRow(row.rowKey, { id: event.target.value })
              }
            />
            <input
              className="corn-field__input"
              value={row.name}
              placeholder="显示名称"
              aria-label={`第 ${index + 1} 个模型的名称`}
              onChange={(event) =>
                editRow(row.rowKey, { name: event.target.value })
              }
            />
            <button
              type="button"
              className="corn-round-button corn-provider-editor__remove-row"
              aria-label={`移除第 ${index + 1} 个模型`}
              disabled={draft.models.length <= 1}
              onClick={() =>
                patch({
                  models: draft.models.filter(
                    (entry) => entry.rowKey !== row.rowKey,
                  ),
                })
              }
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="corn-provider-editor__add-row"
          aria-describedby={modelsId}
          onClick={() => {
            const rowKey = nextRow.current
            nextRow.current += 1
            patch({ models: [...draft.models, { rowKey, id: '', name: '' }] })
          }}
        >
          <Plus size={13} strokeWidth={2} aria-hidden />
          添加模型
        </button>
        {errors.models ? (
          <p id={modelsMessageId} className="corn-field__message" role="alert">
            {errors.models}
          </p>
        ) : null}
      </fieldset>
    </>
  )
}
