import { M1_FIXTURE_WORKSPACE } from '../../tests/fixtures/m1-workspace.ts'
import type { WorkspaceSource } from '../model/workspace.ts'
import { NoticeProvider } from '../shared/notice.tsx'
import { CornShell } from './CornShell.tsx'
import { useRuntimeStatus } from './use-runtime-status.ts'

/**
 * The single place that chooses data sources. M1 uses the labelled fixture;
 * M2 replaces it with a Main-backed source without touching features.
 */
const source: WorkspaceSource = M1_FIXTURE_WORKSPACE

export function CompositionRoot() {
  const runtime = useRuntimeStatus()
  return (
    <NoticeProvider>
      <CornShell source={source} runtime={runtime} />
    </NoticeProvider>
  )
}
