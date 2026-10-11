import { SectionStatus } from '../SectionStatus.tsx'
import type { SectionState } from '../section-state.ts'

/** Files the user shared and what the Bot produced, with their sources. */
export function ArtifactsSection({ state }: { readonly state: SectionState }) {
  return (
    <section className="corn-details__group" aria-label="资料">
      <p className="corn-details__note">
        你分享给它的资料和它产出的成果，会注明来源和关联任务。
      </p>
      <SectionStatus state={state} />
    </section>
  )
}
