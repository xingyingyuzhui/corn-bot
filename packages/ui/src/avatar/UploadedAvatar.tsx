import { AvatarBox } from './AvatarBox.tsx'

export interface UploadedAvatarProps {
  /** A Corn-controlled asset URL (M2); never a user-typed or remote address. */
  readonly src: string
  readonly size: number
  readonly label?: string | undefined
}

/** The user's own image, shown as is; motion never alters it. */
export function UploadedAvatar({ src, size, label }: UploadedAvatarProps) {
  return (
    <AvatarBox size={size} label={label} data-kind="uploaded">
      <img
        className="corn-avatar__image"
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    </AvatarBox>
  )
}
