import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../shared/Button.tsx'
import type { RowStatus } from './save-state.ts'

interface SettingsRowProps {
  readonly label: string
  readonly labelId: string
  /** When set, the label is a `<label for>` pointing at this control. */
  readonly controlId?: string
  readonly description?: string
  readonly status: RowStatus
  readonly onRetry?: () => void
  readonly children: ReactNode
}

function StatusLine({
  status,
  onRetry,
}: {
  readonly status: RowStatus
  readonly onRetry: (() => void) | undefined
}) {
  switch (status.kind) {
    case 'value':
      return null
    case 'pending':
      return (
        <p className="corn-settings-row__status" role="status">
          {status.text}
        </p>
      )
    case 'saved':
      return (
        <p
          className="corn-settings-row__status"
          data-tone="success"
          role="status"
        >
          <Check size={13} strokeWidth={2.2} aria-hidden />
          {status.text}
        </p>
      )
    case 'failure':
      return (
        <div
          className="corn-settings-row__status"
          data-tone="danger"
          role="alert"
        >
          <span>{status.text}</span>
          {onRetry ? <Button onClick={onRetry}>重试</Button> : null}
        </div>
      )
    case 'unavailable':
      return (
        <p className="corn-settings-row__status" data-tone="muted">
          {status.text}
        </p>
      )
    default: {
      const unreachable: never = status
      throw new Error(`Unknown row status ${JSON.stringify(unreachable)}`)
    }
  }
}

/**
 * Kit SettingsRow (card variant): the control shows the value, the status
 * line shows saving / saved / failure / unavailable separately from it.
 */
export function SettingsRow({
  label,
  labelId,
  controlId,
  description,
  status,
  onRetry,
  children,
}: SettingsRowProps) {
  return (
    <div className="corn-settings-row" data-status={status.kind}>
      <div className="corn-settings-row__text">
        {controlId ? (
          <label
            id={labelId}
            htmlFor={controlId}
            className="corn-settings-row__label"
          >
            {label}
          </label>
        ) : (
          <span id={labelId} className="corn-settings-row__label">
            {label}
          </span>
        )}
        {description ? (
          <p className="corn-settings-row__description">{description}</p>
        ) : null}
        <StatusLine status={status} onRetry={onRetry} />
      </div>
      <div className="corn-settings-row__control">{children}</div>
    </div>
  )
}
