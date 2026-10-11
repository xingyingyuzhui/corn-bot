import type { CornAvatarVariantId } from '@corn-bot/contracts/avatar'
import { CORN_AVATAR_VARIANTS, StaticAvatar } from '@corn-bot/ui/avatar'
import { useId } from 'react'
import './avatar-picker.css'

export interface AvatarPickerProps {
  /** `null` while nothing is chosen: a new Bot's default or a placeholder record. */
  readonly value: string | null
  readonly onChange: (variantId: CornAvatarVariantId) => void
  /** Shown while nothing is chosen. */
  readonly emptyHint: string
  readonly error?: string | undefined
  readonly disabled?: boolean
}

/**
 * The 16 Corn roles as a native radio group: Tab enters at the checked role,
 * arrow keys move and select, and each option is named after its role.
 */
export function AvatarPicker({
  value,
  onChange,
  emptyHint,
  error,
  disabled = false,
}: AvatarPickerProps) {
  const name = useId()
  const messageId = useId()
  const selected = CORN_AVATAR_VARIANTS.find((variant) => variant.id === value)
  return (
    <fieldset
      className="corn-field corn-avatar-picker"
      data-invalid={error ? true : undefined}
      aria-describedby={messageId}
      disabled={disabled}
    >
      <legend className="corn-field__label">头像</legend>
      <div className="corn-avatar-picker__grid">
        {CORN_AVATAR_VARIANTS.map((variant) => (
          <label
            key={variant.id}
            className="corn-avatar-picker__option"
            title={variant.name}
          >
            <input
              type="radio"
              className="corn-avatar-picker__input"
              name={name}
              value={variant.id}
              checked={variant.id === value}
              aria-label={variant.name}
              onChange={() => onChange(variant.id)}
            />
            <StaticAvatar variant={variant} size={32} />
          </label>
        ))}
      </div>
      <p
        id={messageId}
        className="corn-field__message"
        role={error ? 'alert' : undefined}
      >
        {error ?? (selected ? `已选：${selected.name}` : emptyHint)}
      </p>
    </fieldset>
  )
}
