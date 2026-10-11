import type {
  ManagedSection,
  SectionSource,
  SectionState,
} from '../features/details/section-state.ts'
import { UNAVAILABLE } from '../shared/unavailable.ts'
import type { FixtureRoute } from './routes.ts'
import { UI_STATES_BOTS } from './ui-states.ts'

const NOT_CONNECTED: Readonly<Record<ManagedSection, SectionState>> = {
  workspace: { kind: 'unavailable', reason: UNAVAILABLE.botWorkspace },
  routines: { kind: 'unavailable', reason: UNAVAILABLE.routines },
  identity: { kind: 'unavailable', reason: UNAVAILABLE.identityDocuments },
  skills: { kind: 'unavailable', reason: UNAVAILABLE.skills },
  artifacts: { kind: 'unavailable', reason: UNAVAILABLE.artifacts },
  memory: { kind: 'unavailable', reason: UNAVAILABLE.memory },
}

/** Dev `ui-states` route only, so the other read states can be reviewed. */
const REVIEW_STATES: Readonly<
  Record<string, Partial<Record<ManagedSection, SectionState>>>
> = {
  [UI_STATES_BOTS.loading]: {
    artifacts: { kind: 'loading' },
    memory: { kind: 'loading' },
  },
  [UI_STATES_BOTS.error]: {
    artifacts: { kind: 'error', reason: '读取资料失败：连接超时（示例）' },
    memory: { kind: 'error', reason: '读取记忆失败：连接超时（示例）' },
  },
  [UI_STATES_BOTS.readOnly]: {
    artifacts: { kind: 'empty', text: '这个 Bot 还没有资料（示例）' },
    memory: { kind: 'empty', text: '这个 Bot 还没有记忆（示例）' },
  },
}

/**
 * M1 management reads: every section is reported as not connected. Nothing
 * here is a real count, file or memory entry.
 */
export function fixtureSections(route: FixtureRoute): SectionSource {
  return (botId, section) =>
    (route === 'ui-states' ? REVIEW_STATES[botId]?.[section] : undefined) ??
    NOT_CONNECTED[section]
}
