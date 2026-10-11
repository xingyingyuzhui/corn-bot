import type { ReactNode } from 'react'
import { useNotice } from './notice.tsx'

type Availability =
  | { readonly onPress: () => void; readonly unavailable?: undefined }
  | { readonly onPress?: undefined; readonly unavailable: string }

type ActionButtonProps = Availability & {
  readonly label: string
  readonly className: string
  readonly children: ReactNode
}

/**
 * Every visible control either acts or says why it cannot yet. Unavailable
 * controls keep the reference appearance, stay focusable and announce their
 * reason on activation instead of silently doing nothing.
 */
export function ActionButton({
  label,
  className,
  children,
  onPress,
  unavailable,
}: ActionButtonProps) {
  const notify = useNotice()
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-disabled={unavailable ? true : undefined}
      aria-description={unavailable}
      title={unavailable ? `${label}：${unavailable}` : label}
      onClick={unavailable ? () => notify(unavailable) : onPress}
    >
      {children}
    </button>
  )
}
