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
  /** A write is in flight: Escape, the backdrop and × cannot close it. */
  readonly busy?: boolean
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
  busy = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const unmounting = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    unmounting.current = false
    dialog.showModal()
    dialog.querySelector<HTMLElement>(`[${DIALOG_AUTOFOCUS}]`)?.focus()
    return () => {
      unmounting.current = true
      dialog.close()
    }
  }, [])

  // Disabled buttons drop focus to <body>; bring it back once the write settles.
  useEffect(() => {
    const dialog = ref.current
    if (busy || !dialog?.open || dialog.contains(document.activeElement)) return
    ;(
      dialog.querySelector<HTMLElement>(`[${DIALOG_AUTOFOCUS}]`) ?? dialog
    ).focus()
  }, [busy])

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
        if (!busy) onClose()
      }}
      onClose={() => {
        // Chromium lets a page veto Escape only once per user activation; a
        // repeated Escape closes the dialog natively, so reopen or follow it.
        // StrictMode's remount reopens the dialog before the stale event lands.
        if (unmounting.current || ref.current?.open) return
        if (busy) ref.current?.showModal()
        else onClose()
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        const fromBackdrop = pressedBackdrop.current
        pressedBackdrop.current = false
        if (fromBackdrop && !busy && event.target === event.currentTarget)
          onClose()
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
            disabled={busy}
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
