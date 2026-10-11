import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import { NAME_MAX } from '../../fixtures/fixture-repository.ts'
import type { BotDraft } from '../../model/repository.ts'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { TextField } from '../../shared/TextField.tsx'
import {
  type CreateBotErrors,
  type CreateBotForm,
  EMPTY_CREATE_BOT_FORM,
  errorsFromResult,
  validateCreateBot,
} from './create-bot-form.ts'
import './create-bot.css'

export interface CreateBotDialogProps {
  readonly onClose: () => void
  readonly onCreated: (botId: string) => void
}

const UNGROUPED = ''

export function CreateBotDialog({ onClose, onCreated }: CreateBotDialogProps) {
  const repository = useRepository()
  const { roster } = useWorkspace()
  const notify = useNotice()
  const formId = useId()
  const groupFieldId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [form, setForm] = useState<CreateBotForm>(EMPTY_CREATE_BOT_FORM)
  const [errors, setErrors] = useState<CreateBotErrors>({})
  const [pending, setPending] = useState(false)

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])

  const edit = (patch: Partial<CreateBotForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => key !== 'form' && !(key in patch),
        ),
      ),
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const invalid = validateCreateBot(form, NAME_MAX)
    if (invalid) {
      setErrors(invalid)
      focusFirstInvalid(formRef.current)
      return
    }
    setPending(true)
    const draft: BotDraft = {
      name: form.name,
      role: form.role,
      workStyle: form.workStyle,
      groupId: form.groupId === UNGROUPED ? null : form.groupId,
    }
    const result = await repository.createBot(draft)
    setPending(false)
    if (result.ok) {
      notify(`已创建示例 Bot“${form.name.trim()}”`)
      onCreated(result.value)
      return
    }
    setErrors(errorsFromResult(result.error))
    focusFirstInvalid(formRef.current)
  }

  const nameLength = [...form.name.trim()].length

  return (
    <Dialog
      title="新建 Bot"
      description="只会在本机创建示例 Bot，不会创建真实 Claw Agent；M2 接通后才能创建真实 Bot。"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            pending={pending}
          >
            {pending ? '正在创建…' : '创建示例 Bot'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="corn-create-bot"
        noValidate
        aria-busy={pending || undefined}
        onSubmit={(event) => void submit(event)}
      >
        <TextField
          label="名称"
          name="name"
          value={form.name}
          required
          placeholder="例如：数据分析师"
          hint={`${nameLength}/${NAME_MAX}`}
          {...(errors.name ? { error: errors.name } : {})}
          onChange={(name) => edit({ name })}
        />
        <TextField
          label="职责"
          name="role"
          value={form.role}
          required
          multiline
          placeholder="这个 Bot 负责什么"
          {...(errors.role ? { error: errors.role } : {})}
          onChange={(role) => edit({ role })}
        />
        <TextField
          label="工作风格"
          name="workStyle"
          value={form.workStyle}
          multiline
          placeholder="可选：语气、习惯、需要遵守的约定"
          onChange={(workStyle) => edit({ workStyle })}
        />
        <div
          className="corn-field"
          data-invalid={errors.groupId ? true : undefined}
        >
          <label htmlFor={groupFieldId} className="corn-field__label">
            分组
          </label>
          <select
            id={groupFieldId}
            name="groupId"
            className="corn-field__input corn-create-bot__select"
            value={form.groupId}
            aria-invalid={errors.groupId ? true : undefined}
            aria-describedby={
              errors.groupId ? `${groupFieldId}-error` : undefined
            }
            onChange={(event) => edit({ groupId: event.target.value })}
          >
            <option value={UNGROUPED}>未分组</option>
            {roster.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
          {errors.groupId ? (
            <p
              id={`${groupFieldId}-error`}
              className="corn-field__message"
              role="alert"
            >
              {errors.groupId}
            </p>
          ) : null}
        </div>
        {errors.form ? (
          <p className="corn-create-bot__error" role="alert">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  })
}
