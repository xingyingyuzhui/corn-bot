import { nameLength } from '../../model/names.ts'
import type { CommandError } from '../../model/repository.ts'

export interface CreateBotForm {
  readonly name: string
  readonly role: string
  readonly workStyle: string
  /** Empty string means 未分组. */
  readonly groupId: string
}

export const EMPTY_CREATE_BOT_FORM: CreateBotForm = {
  name: '',
  role: '',
  workStyle: '',
  groupId: '',
}

export type CreateBotErrors = Partial<
  Record<keyof CreateBotForm | 'form', string>
>

/** Same rules as the repository, checked first so typos never round-trip. */
export function validateCreateBot(
  form: CreateBotForm,
  nameMax: number,
): CreateBotErrors | null {
  const errors: { -readonly [K in keyof CreateBotErrors]: string } = {}
  const name = form.name.trim()
  if (!name) errors.name = '请填写名称'
  else if (nameLength(name) > nameMax) errors.name = `名称最多 ${nameMax} 个字`
  if (!form.role.trim()) errors.role = '请填写职责'
  return Object.keys(errors).length ? errors : null
}

const FIELDS: ReadonlySet<string> = new Set([
  'name',
  'role',
  'workStyle',
  'groupId',
])

/** Repository errors land on their field; anything else is a form error. */
export function errorsFromResult(error: CommandError): CreateBotErrors {
  return error.field && FIELDS.has(error.field)
    ? { [error.field]: error.message }
    : { form: error.message }
}
