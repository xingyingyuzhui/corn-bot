import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from 'react'
import type { WorkspaceRepository } from '../model/repository.ts'
import type { WorkspaceSnapshot } from '../model/workspace.ts'

const RepositoryContext = createContext<WorkspaceRepository | null>(null)

export function WorkspaceProvider({
  repository,
  children,
}: {
  readonly repository: WorkspaceRepository
  readonly children: ReactNode
}) {
  return (
    <RepositoryContext.Provider value={repository}>
      {children}
    </RepositoryContext.Provider>
  )
}

/** Commands for features; every call resolves to a typed `CommandResult`. */
export function useRepository(): WorkspaceRepository {
  const repository = useContext(RepositoryContext)
  if (!repository) throw new Error('useRepository outside WorkspaceProvider')
  return repository
}

export function useWorkspace(): WorkspaceSnapshot {
  const repository = useRepository()
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot)
}
