import { FixtureWorkspaceRepository } from '../fixtures/fixture-repository.ts'
import { ModelSettingsFixture } from '../fixtures/model-settings-fixture.ts'
import { parseFixtureRoute } from '../fixtures/routes.ts'
import { parseRuntimeFixture } from '../fixtures/runtime-states.ts'
import { createUiStatesRepository } from '../fixtures/ui-states.ts'
import {
  livePort,
  type ModelSettingsPort,
} from '../model/model-settings-port.ts'
import type { WorkspaceRepository } from '../model/repository.ts'
import { NoticeProvider } from '../shared/notice.tsx'
import { CornShell } from './CornShell.tsx'
import { ModelSettingsProvider } from './model-settings-context.tsx'
import { RuntimeAnnouncer } from './RuntimeAnnouncer.tsx'
import { useModelStatus } from './use-model-status.ts'
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
const runtimeFixture =
  parseRuntimeFixture(window.location.hash, import.meta.env.DEV) !== null
const useRuntime = runtimeFixture ? useRuntimeFixture : useRuntimeStatus

const bridge = window.corn?.modelSettings
const modelSettings: ModelSettingsPort = bridge
  ? livePort(bridge)
  : new ModelSettingsFixture(undefined, { latencyMs: 300 })
/** The chat's model line needs a runtime to sit under: Main's, or a dev fixture. */
const modelStatusSource = bridge || runtimeFixture ? modelSettings : null

export function CompositionRoot() {
  const runtime = useRuntime()
  const model = useModelStatus(modelStatusSource)
  return (
    <WorkspaceProvider repository={repository}>
      <ModelSettingsProvider port={modelSettings}>
        <NoticeProvider>
          <CornShell runtime={runtime} model={model} />
        </NoticeProvider>
      </ModelSettingsProvider>
      <RuntimeAnnouncer
        source={repository.label}
        reading={runtime}
        model={model}
      />
    </WorkspaceProvider>
  )
}
