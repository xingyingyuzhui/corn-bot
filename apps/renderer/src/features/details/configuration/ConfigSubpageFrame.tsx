import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  CONFIG_PAGE_CATALOG,
  type ConfigSubpage,
} from '../details-navigation.ts'

/** The heading the pane focuses when a subpage opens. */
export const PAGE_HEADING_SELECTOR = '[data-details-heading]'

interface ConfigSubpageFrameProps {
  readonly page: ConfigSubpage
  readonly onBack: () => void
  readonly children: ReactNode
}

export function ConfigSubpageFrame({
  page,
  onBack,
  children,
}: ConfigSubpageFrameProps) {
  const entry = CONFIG_PAGE_CATALOG[page]
  return (
    <div className="corn-details__subpage">
      <button type="button" className="corn-details__back" onClick={onBack}>
        <ChevronLeft size={15} strokeWidth={2} aria-hidden />
        返回配置
      </button>
      <h3 className="corn-details__heading" tabIndex={-1} data-details-heading>
        {entry.label}
      </h3>
      <p className="corn-details__lead">{entry.description}</p>
      {children}
    </div>
  )
}
