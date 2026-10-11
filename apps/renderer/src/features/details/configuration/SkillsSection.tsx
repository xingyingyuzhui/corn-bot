import { SectionStatus } from '../SectionStatus.tsx'
import type { SectionState } from '../section-state.ts'

/** Skills are listed once a verified catalog exists; installing stays global. */
export function SkillsSection({ state }: { readonly state: SectionState }) {
  return (
    <section className="corn-details__group" aria-label="技能列表">
      <SectionStatus state={state} />
      <p className="corn-details__note">
        安装技能属于全局能力管理，不在单个 Bot 的配置里进行。
      </p>
    </section>
  )
}
