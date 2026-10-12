import type { ModelStatusView } from '@corn-bot/contracts/model-settings'
import { useState } from 'react'
import {
  type DataSource,
  nextAnnouncement,
  type RuntimeReading,
  SILENT,
} from './runtime-notice.ts'

interface RuntimeAnnouncerProps {
  readonly source: DataSource
  readonly reading: RuntimeReading
  /** Model readiness, or `null` when no model status is available. */
  readonly model: ModelStatusView | null
}

/**
 * The app's only live region for the data source, runtime and model status.
 * It sits above the shell, so Bot switches, layout changes and ChatPane
 * remounts never reach it; the visible strip in the chat pane stays silent.
 */
export function RuntimeAnnouncer({
  source,
  reading,
  model,
}: RuntimeAnnouncerProps) {
  const [announcement, setAnnouncement] = useState(SILENT)
  const next = nextAnnouncement(announcement, source, reading, model)
  if (next !== announcement) setAnnouncement(next)
  return (
    <div
      className="corn-visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-runtime-announcer
    >
      {next.text ? <span key={next.count}>{next.text}</span> : null}
    </div>
  )
}
