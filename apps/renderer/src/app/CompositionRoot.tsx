import { FixtureWorkspaceRepository } from '../fixtures/fixture-repository.ts'
import { parseFixtureRoute } from '../fixtures/routes.ts'
import { parseRuntimeFixture } from '../fixtures/runtime-states.ts'
import { createUiStatesRepository } from '../fixtures/ui-states.ts'
import type { WorkspaceRepository } from '../model/repository.ts'
import { NoticeProvider } from '../shared/notice.tsx'
import { CornShell } from './CornShell.tsx'
import { RuntimeAnnouncer } from './RuntimeAnnouncer.tsx'
import { useRuntimeFixture, useRuntimeStatus } from './use-runtime-status.ts'
import { WorkspaceProvider } from './workspace-context.tsx'

/**
 * The single place that chooses data sources. M1 binds the labelled fixture
 * repository; M2 binds a Main-backed one without touching features.
 */
function chooseRepository(): WorkspaceRepository {
  const route = parseFixtureRoute(window.location.hash, import.meta.env.DEV)
  switch (route) {
    case 'ui-states':
      return createUiStatesRepository()
    case 'default':
      return new FixtureWorkspaceRepository(undefined, { latencyMs: 300 })
    default: {
      const unreachable: never = route
      throw new Error(`Unknown fixture route ${String(unreachable)}`)
    }
  }
}

const repository = chooseRepository()
const useRuntime =
  parseRuntimeFixture(window.location.hash, import.meta.env.DEV) === null
    ? useRuntimeStatus
    : useRuntimeFixture

export function CompositionRoot() {
  const runtime = useRuntime()
  return (
    <WorkspaceProvider repository={repository}>
      <NoticeProvider>
        <CornShell runtime={runtime} />
      </NoticeProvider>
      <RuntimeAnnouncer source={repository.label} reading={runtime} />
    </WorkspaceProvider>
  )
}
