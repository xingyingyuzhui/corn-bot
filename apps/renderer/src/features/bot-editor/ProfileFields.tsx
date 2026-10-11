import { NAME_MAX } from '../../model/limits.ts'
import { nameLength } from '../../model/names.ts'
import { TextField } from '../../shared/TextField.tsx'
import { AvatarPicker } from './AvatarPicker.tsx'
import { nameLengthError } from './create-bot-form.ts'
import type { ProfileDraft, ProfileField } from './profile-form.ts'
import type { BotEditor } from './use-bot-editor.ts'

interface ProfileFieldsProps {
  readonly editor: BotEditor<ProfileDraft>
  /** Dialogs focus the name; subpages focus their heading instead. */
  readonly autoFocus?: boolean
}

/**
 * Name, role, work style and Corn role avatar, embedded by the dialog and the
 * subpage; locked while the editor's write is in flight.
 */
export function ProfileFields({
  editor: { controller, state },
  autoFocus = false,
}: ProfileFieldsProps) {
  const { draft, fieldErrors, saving } = state
  const edit = (field: ProfileField) => (value: string) =>
    controller.edit((current) => ({ ...current, [field]: value }), field)
  const fieldError = (field: ProfileField) => {
    const error = fieldErrors[field]
    return error === undefined ? {} : { error }
  }
  return (
    <>
      <TextField
        label="名称"
        name="name"
        value={draft.name}
        onChange={edit('name')}
        required
        disabled={saving}
        autoFocus={autoFocus}
        hint={`${nameLength(draft.name)}/${NAME_MAX}`}
        error={fieldErrors.name ?? nameLengthError(draft.name, NAME_MAX)}
      />
      <TextField
        label="职责"
        name="role"
        value={draft.role}
        onChange={edit('role')}
        multiline
        required
        disabled={saving}
        placeholder="它负责什么"
        {...fieldError('role')}
      />
      <TextField
        label="工作风格"
        name="workStyle"
        value={draft.workStyle}
        onChange={edit('workStyle')}
        multiline
        disabled={saving}
        placeholder="它应该怎样做事，例如：先列计划，再动手"
        {...fieldError('workStyle')}
      />
      <AvatarPicker
        value={draft.variantId}
        onChange={edit('variantId')}
        emptyHint="当前是首字头像，可以选一个玉米角色"
        error={fieldErrors.variantId}
        disabled={saving}
      />
    </>
  )
}
