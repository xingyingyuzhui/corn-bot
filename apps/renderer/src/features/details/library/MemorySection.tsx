import { SectionStatus } from '../SectionStatus.tsx'
import type { SectionState } from '../section-state.ts'

const MEMORY_PARTS = [
  { id: 'user', label: '关于你', file: 'USER' },
  { id: 'memory', label: '长期记忆', file: 'MEMORY' },
  { id: 'journal', label: '日记', file: '按日期' },
  { id: 'pending', label: '待确认记忆', file: '需要你确认' },
] as const

/** This Bot's memory only; Claw Memory settings are global, not per Bot. */
export function MemorySection({ state }: { readonly state: SectionState }) {
  return (
    <section className="corn-details__group" aria-label="记忆">
      <ul className="corn-details__list">
        {MEMORY_PARTS.map((part) => (
          <li key={part.id} className="corn-details__list-item">
            <span className="corn-details__list-label">
              {part.label}
              <span className="corn-details__file">{part.file}</span>
            </span>
          </li>
        ))}
      </ul>
      <SectionStatus state={state} />
    </section>
  )
}
