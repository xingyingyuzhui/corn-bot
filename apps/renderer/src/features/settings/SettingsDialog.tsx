import { Cpu, SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import type { SettingsSection } from '../../app/layout-state.ts'
import { Dialog } from '../../shared/Dialog.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { ModelsSection } from './ModelsSection.tsx'
import { SECTION_LABELS, SETTINGS_SECTIONS } from './settings-options.ts'
import './settings.css'

export interface SettingsDialogProps {
  readonly section: SettingsSection
  readonly onSection: (section: SettingsSection) => void
  readonly onClose: () => void
}

const ICONS: Readonly<Record<SettingsSection, typeof Cpu>> = {
  general: SlidersHorizontal,
  models: Cpu,
}

function SectionBody({ section }: { readonly section: SettingsSection }) {
  switch (section) {
    case 'general':
      return <GeneralSection />
    case 'models':
      return <ModelsSection />
    default: {
      const unreachable: never = section
      throw new Error(`Unknown settings section ${JSON.stringify(unreachable)}`)
    }
  }
}

export function SettingsDialog({
  section,
  onSection,
  onClose,
}: SettingsDialogProps) {
  const headingId = useId()
  return (
    <Dialog title="设置" size="lg" onClose={onClose}>
      <div className="corn-settings">
        <nav className="corn-settings__nav" aria-label="设置分区">
          {SETTINGS_SECTIONS.map((id) => {
            const Icon = ICONS[id]
            return (
              <button
                key={id}
                type="button"
                className="corn-settings__nav-item"
                aria-current={id === section ? 'page' : undefined}
                onClick={() => onSection(id)}
              >
                <Icon size={15} strokeWidth={2} aria-hidden />
                {SECTION_LABELS[id]}
              </button>
            )
          })}
        </nav>
        <section className="corn-settings__panel" aria-labelledby={headingId}>
          <h3 id={headingId} className="corn-settings__heading">
            {SECTION_LABELS[section]}
          </h3>
          <SectionBody section={section} />
        </section>
      </div>
    </Dialog>
  )
}
