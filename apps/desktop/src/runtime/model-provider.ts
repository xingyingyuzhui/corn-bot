import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

/** Routes Corn knows how to wire; each owns exactly one Host credential variable. */
export const CORN_MODEL_ROUTES = [
  'deepseek-official',
  'xiaomi-token-plan-cn',
] as const
export type CornModelRoute = (typeof CORN_MODEL_ROUTES)[number]

export interface CornModelConfig {
  route: CornModelRoute
  model: string
  apiKey: string
}

interface RoutePlan {
  hostKeyEnv: string
  patch: Array<{ id: string; config: Record<string, unknown> }>
}

export function routePlan(route: CornModelRoute): RoutePlan {
  switch (route) {
    case 'deepseek-official':
      return { hostKeyEnv: 'DEEPSEEK_API_KEY', patch: [] }
    case 'xiaomi-token-plan-cn':
      // pi-ai ships this catalog (endpoint, models, reasoning_content replay); only the key reference is Corn's.
      return {
        hostKeyEnv: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
        patch: [
          {
            id: 'llm-pi-ai',
            config: {
              providers: {
                'xiaomi-token-plan-cn': {
                  apiKeyEnv: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
                },
              },
            },
          },
        ],
      }
    default: {
      const unreachable: never = route
      throw new Error(`Unknown Corn model route ${String(unreachable)}`)
    }
  }
}

export function defaultModelEnvFile(): string {
  return join(homedir(), '.corn-bot-dev', 'model.env')
}

function isRoute(value: string): value is CornModelRoute {
  return (CORN_MODEL_ROUTES as readonly string[]).includes(value)
}

function readModelEnvFile(path: string): Record<string, string> {
  let mode: number
  try {
    mode = statSync(path).mode
  } catch {
    return {}
  }
  if ((mode & 0o077) !== 0)
    throw new Error('Corn model env file must not be group or world readable')
  return parseEnv(readFileSync(path, 'utf8')) as Record<string, string>
}

/**
 * Explicit Corn-only model configuration: process variables win over the
 * private env file; ambient provider variables are never consulted.
 */
export function resolveCornModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): CornModelConfig | null {
  const file = readModelEnvFile(
    env.CORN_MODEL_ENV_FILE ?? defaultModelEnvFile(),
  )
  const pick = (key: string) => env[key] ?? file[key]
  const route = pick('CORN_MODEL_PROVIDER')
  const model = pick('CORN_MODEL_ID')
  const apiKey = pick('CORN_MODEL_API_KEY')
  if (!route && !model && !apiKey) return null
  if (!route || !isRoute(route))
    throw new Error(
      `CORN_MODEL_PROVIDER must be one of ${CORN_MODEL_ROUTES.join(', ')}`,
    )
  if (!model || !apiKey)
    throw new Error('CORN_MODEL_ID and CORN_MODEL_API_KEY are both required')
  return { route, model, apiKey }
}
