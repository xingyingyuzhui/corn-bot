import {
  LIBRARY_SECTION_LABELS,
  LIBRARY_SECTIONS,
  type LibrarySection,
} from '../details-navigation.ts'
import type { SectionSource } from '../section-state.ts'
import { ArtifactsSection } from './ArtifactsSection.tsx'
import { MemorySection } from './MemorySection.tsx'

interface BotLibraryProps {
  readonly botId: string
  readonly section: LibrarySection
  readonly sections: SectionSource
  readonly onSection: (section: LibrarySection) => void
}

/** 资料 and 记忆 keep their own sources; nothing merges them into one list. */
export function BotLibrary({
  botId,
  section,
  sections,
  onSection,
}: BotLibraryProps) {
  return (
    <>
      <nav className="corn-details__segments" aria-label="资料库分区">
        {LIBRARY_SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className="corn-details__segment"
            aria-current={id === section ? 'true' : undefined}
            onClick={() => onSection(id)}
          >
            {LIBRARY_SECTION_LABELS[id]}
          </button>
        ))}
      </nav>
      {section === 'artifacts' ? (
        <ArtifactsSection state={sections(botId, 'artifacts')} />
      ) : (
        <MemorySection state={sections(botId, 'memory')} />
      )}
    </>
  )
}
