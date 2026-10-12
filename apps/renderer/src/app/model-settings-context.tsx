import { createContext, type ReactNode, useContext } from 'react'
import type { ModelSettingsPort } from '../model/model-settings-port.ts'

const ModelSettingsContext = createContext<ModelSettingsPort | null>(null)

export function ModelSettingsProvider({
  port,
  children,
}: {
  readonly port: ModelSettingsPort
  readonly children: ReactNode
}) {
  return (
    <ModelSettingsContext.Provider value={port}>
      {children}
    </ModelSettingsContext.Provider>
  )
}

/** Model settings commands; every call resolves to a closed result. */
export function useModelSettingsPort(): ModelSettingsPort {
  const port = useContext(ModelSettingsContext)
  if (!port)
    throw new Error('useModelSettingsPort outside ModelSettingsProvider')
  return port
}
