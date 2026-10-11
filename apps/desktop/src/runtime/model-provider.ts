import { readFileSync, type Stats, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { RuntimeFailure } from './runtime-failure.ts'

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

/** Only a missing file means "not configured"; any other problem with an existing file is refused. */
function readModelEnvFile(path: string): Record<string, string> {
  const unreadable = (cause?: unknown) =>
    new RuntimeFailure(
      'model_config_unreadable',
      'Corn model env file cannot be read',
      { cause },
    )
  let stat: Stats
  try {
    stat = statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw unreadable(error)
  }
  if (!stat.isFile()) throw unreadable()
  if ((stat.mode & 0o077) !== 0)
    throw new RuntimeFailure(
      'model_config_permissions',
      'Corn model env file must not be group or world readable',
    )
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw unreadable(error)
  }
  return parseEnv(text) as Record<string, string>
}

/**
 * Explicit Corn-only model configuration; ambient provider variables are never
 * consulted. Route and key always come from one source: a process-level route
 * or key replaces the private env file entirely, so one provider's key can
 * never be sent to another. Only the model id may override the file's route.
 */
export function resolveCornModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): CornModelConfig | null {
  const processOwned =
    env.CORN_MODEL_PROVIDER !== undefined ||
    env.CORN_MODEL_API_KEY !== undefined
  const source = processOwned
    ? env
    : readModelEnvFile(env.CORN_MODEL_ENV_FILE ?? defaultModelEnvFile())
  const route = source.CORN_MODEL_PROVIDER
  const model = processOwned
    ? env.CORN_MODEL_ID
    : (env.CORN_MODEL_ID ?? source.CORN_MODEL_ID)
  const apiKey = source.CORN_MODEL_API_KEY
  if (!route && !model && !apiKey) return null
  if (!route || !isRoute(route))
    throw new RuntimeFailure(
      'model_config_invalid',
      `CORN_MODEL_PROVIDER must be one of ${CORN_MODEL_ROUTES.join(', ')}`,
    )
  if (!model || !apiKey)
    throw new RuntimeFailure(
      'model_config_invalid',
      'CORN_MODEL_ID and CORN_MODEL_API_KEY are both required',
    )
  return { route, model, apiKey }
}
