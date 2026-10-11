import {
  type CornAvatarShape,
  type CornAvatarVariantId,
  isCornAvatarVariantId,
} from '@corn-bot/contracts/avatar'

export interface CornAvatarVariant {
  readonly id: CornAvatarVariantId
  /** Role name shown next to the artwork; the artwork itself stays decorative. */
  readonly name: string
  readonly shape: CornAvatarShape
  readonly body: string
  readonly husk: string
  readonly eye: string
}

const variant = (
  id: CornAvatarVariantId,
  name: string,
  shape: CornAvatarShape,
  body: string,
  husk: string,
): CornAvatarVariant =>
  Object.freeze({ id, name, shape, body, husk, eye: '#191B1C' })

/** Corn-original role catalog, locked in `design/corn-assets/ASSET_LOCK.json`. */
export const CORN_AVATAR_VARIANTS: readonly CornAvatarVariant[] = Object.freeze(
  [
    variant('xiaohuang', '小黄', 'cob', '#FFD968', '#8CAB68'),
    variant('ops', '运维管家', 'round-cob', '#FFCB79', '#739771'),
    variant('backend', '后端工程师', 'tall-cob', '#F3CB61', '#578D82'),
    variant('frontend', '前端工程师', 'baby-cob', '#FFDFA0', '#86A978'),
    variant('architect', '架构师', 'husk-bud', '#ECC773', '#668A82'),
    variant('news', '资讯专员', 'husk-fan', '#FFDA76', '#91AF70'),
    variant('excel', 'Excel专员', 'twin-kernel', '#EBD578', '#669C6C'),
    variant('cad', 'CAD专员', 'kernel', '#F3C778', '#659992'),
    variant('word', 'Word专员', 'tall-cob', '#FFE2A0', '#809CB2'),
    variant('pdf', 'PDF专员', 'round-cob', '#FFD19A', '#B28B80'),
    variant('ppt', 'PPT专员', 'popcorn', '#FFE6AD', '#AFA075'),
    variant('wechat', '公众号运营', 'husk-bud', '#F4DB8A', '#79AA77'),
    variant('video', '视频专员', 'popcorn', '#FFE8BB', '#AA92AD'),
    variant('audio', '音频专员', 'twin-kernel', '#F7D6A1', '#8B96B2'),
    variant('sales', '销售专员', 'baby-cob', '#FFD27B', '#B5966B'),
    variant('research', '研究专员', 'kernel', '#F2DC91', '#7AA5A0'),
  ],
)

/** `null` for missing or unknown ids, so callers fall back to the initial placeholder. */
export function findAvatarVariant(
  id: string | undefined,
): CornAvatarVariant | null {
  if (!isCornAvatarVariantId(id)) return null
  return CORN_AVATAR_VARIANTS.find((entry) => entry.id === id) ?? null
}
