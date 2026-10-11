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
  readonly size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Drops body padding for layouts that draw their own panes (settings). */
  readonly flush?: boolean
}

/**
 * Marks the element `Dialog` focuses after `showModal()`. React's `autoFocus`
 * runs while the dialog is still closed, so it never takes effect here.
 */
const DIALOG_AUTOFOCUS = 'data-autofocus'

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
  flush = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    dialog.querySelector<HTMLElement>(`[${DIALOG_AUTOFOCUS}]`)?.focus()
    return () => dialog.close()
  }, [])

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes through the native cancel event
    <dialog
      ref={ref}
      className="corn-dialog"
      data-size={size}
      data-flush={flush || undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        const fromBackdrop = pressedBackdrop.current
        pressedBackdrop.current = false
        if (fromBackdrop && event.target === event.currentTarget) onClose()
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
