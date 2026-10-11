import { useId } from 'react'
import './controls.css'

interface TextFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly error?: string | null
  readonly hint?: string
  readonly multiline?: boolean
  readonly required?: boolean
  readonly placeholder?: string
  /** Initial focus when shown inside `Dialog` (rendered as `data-autofocus`). */
  readonly autoFocus?: boolean
  readonly name?: string
  readonly disabled?: boolean
}

/** Labelled input whose error is announced and tied to the field. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  multiline = false,
  required = false,
  placeholder,
  autoFocus,
  name,
  disabled = false,
}: TextFieldProps) {
  const id = useId()
  const messageId = useId()
  const message = error ?? hint
  const shared = {
    id,
    name,
    value,
    placeholder,
    required,
    disabled,
    'data-autofocus': autoFocus || undefined,
    className: 'corn-field__input',
    'aria-invalid': error ? true : undefined,
    'aria-describedby': message ? messageId : undefined,
  } as const
  return (
    <div className="corn-field" data-invalid={error ? true : undefined}>
      <label htmlFor={id} className="corn-field__label">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...shared}
          type="text"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {message ? (
        <p
          id={messageId}
          className="corn-field__message"
          role={error ? 'alert' : undefined}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
