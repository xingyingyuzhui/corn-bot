import { Button } from '../../../shared/Button.tsx'

interface SubpageFormActionsProps {
  readonly formId: string
  readonly dirty: boolean
  readonly saving: boolean
  readonly conflict: boolean
  readonly onDiscard: () => void
}

/** Save submits the subpage form; discard returns to the stored values. */
export function SubpageFormActions({
  formId,
  dirty,
  saving,
  conflict,
  onDiscard,
}: SubpageFormActionsProps) {
  return (
    <div className="corn-details__form-actions">
      <Button variant="ghost" disabled={!dirty || saving} onClick={onDiscard}>
        放弃修改
      </Button>
      <Button
        variant="primary"
        type="submit"
        form={formId}
        pending={saving}
        disabled={!dirty || conflict}
      >
        {saving ? '正在保存…' : '保存'}
      </Button>
    </div>
  )
}
