import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import './dialog.css'

interface DialogProps {
  readonly title: string
  /** Optional one-line explanation under the title. */
  readonly description?: string
  readonly onClose: () => void
  readonly children: ReactNode
  /** Footer actions, laid out end-aligned. */
  readonly actions?: ReactNode
  readonly size?: 'sm' | 'md' | 'lg'
}

/**
 * Modal built on the native `<dialog>`: the browser supplies the focus trap,
 * inert background, Escape handling and focus return to the opener.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  actions,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes through the native cancel event
    <dialog
      ref={ref}
      className="corn-dialog"
      data-size={size}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="corn-dialog__surface">
        <header className="corn-dialog__header">
          <h2 id={titleId} className="corn-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="corn-round-button corn-dialog__close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </header>
        {description ? (
          <p id={descriptionId} className="corn-dialog__description">
            {description}
          </p>
        ) : null}
        <div className="corn-dialog__body">{children}</div>
        {actions ? (
          <footer className="corn-dialog__actions">{actions}</footer>
        ) : null}
      </div>
    </dialog>
  )
}
