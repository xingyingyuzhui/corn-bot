import type { ReactNode } from 'react'
import './controls.css'

interface ButtonProps {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  readonly type?: 'button' | 'submit'
  /** In-flight command: announced as busy and guarded against repeats. */
  readonly pending?: boolean
  readonly disabled?: boolean
  readonly onClick?: () => void
  readonly children: ReactNode
  readonly form?: string
}

/** Text button for dialogs and cards (kit `md`: 30px high, 15px radius). */
export function Button({
  variant = 'secondary',
  type = 'button',
  pending = false,
  disabled = false,
  onClick,
  children,
  form,
}: ButtonProps) {
  return (
    <button
      type={type}
      form={form}
      className="corn-button"
      data-variant={variant}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
