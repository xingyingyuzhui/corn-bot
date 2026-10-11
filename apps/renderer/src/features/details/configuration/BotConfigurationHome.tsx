import { ChevronRight } from 'lucide-react'
import {
  CONFIG_PAGE_CATALOG,
  CONFIG_SUBPAGES,
  type ConfigSubpage,
} from '../details-navigation.ts'

export const configEntryId = (page: ConfigSubpage) => `details-config-${page}`

interface BotConfigurationHomeProps {
  readonly summaries: Readonly<Record<ConfigSubpage, string>>
  readonly onOpen: (page: ConfigSubpage) => void
}

/** Four entry rows; each opens its subpage inside the pane. */
export function BotConfigurationHome({
  summaries,
  onOpen,
}: BotConfigurationHomeProps) {
  return (
    <nav aria-label="配置分区">
      <ul className="corn-details__entries">
        {CONFIG_SUBPAGES.map((page) => (
          <li key={page}>
            <button
              id={configEntryId(page)}
              type="button"
              className="corn-details__entry"
              onClick={() => onOpen(page)}
            >
              <span className="corn-details__entry-text">
                <span className="corn-details__entry-label">
                  {CONFIG_PAGE_CATALOG[page].label}
                </span>
                <span className="corn-details__entry-summary">
                  {summaries[page]}
                </span>
              </span>
              <ChevronRight size={15} strokeWidth={2} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
