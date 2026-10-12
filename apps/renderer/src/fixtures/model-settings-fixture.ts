import {
  apiKeyProblem,
  type CatalogGroupView,
  type CatalogModelView,
  type ClearProviderKeyCommand,
  CUSTOM_ROUTE_PATTERN,
  type CustomProviderFields,
  isHttpUrl,
  type ModelProviderView,
  type ModelSettingsErrorCode,
  type ModelSettingsResult,
  type ModelSettingsSnapshot,
  type ModelStatusView,
  type RemoveCustomProviderCommand,
  type SaveCustomProviderCommand,
  type SetDefaultModelCommand,
  type SetProviderKeyCommand,
} from '@corn-bot/contracts/model-settings'
import type { ModelSettingsPort } from '../model/model-settings-port.ts'

export interface ModelSettingsFixtureOptions {
  /** Artificial latency so pending states are visible; 0 in unit tests. */
  readonly latencyMs?: number
}

type Result = ModelSettingsResult<ModelSettingsSnapshot>

const GENERATION = 1
const PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

const DEEPSEEK_EFFORTS = ['off', 'low', 'high', 'max'] as const

const deepseekModels: readonly CatalogModelView[] = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek Flash',
    efforts: DEEPSEEK_EFFORTS,
    defaultEffort: 'high',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    efforts: DEEPSEEK_EFFORTS,
    defaultEffort: 'high',
  },
]

/** Sample models a catalog route gains once it has a key. */
const CATALOG_MODELS: Readonly<Record<string, readonly CatalogModelView[]>> = {
  openai: [{ id: 'gpt-5.1', name: 'GPT-5.1', efforts: [] }],
  'xiaomi-token-plan-cn': [{ id: 'mimo-v2', name: 'MiMo V2', efforts: [] }],
  moonshotai: [{ id: 'kimi-k2', name: 'Kimi K2', efforts: [] }],
}

const catalogRoute = (id: string, name: string): ModelProviderView => ({
  id,
  name,
  kind: 'catalog',
  active: false,
  configured: false,
  settingsWritable: true,
  credential: { kind: 'missing', writable: true },
  sharesKeyWith: [],
  revision: 0,
})

const SAMPLE_CUSTOM: CustomProviderFields = {
  displayName: '本地兼容服务（示例）',
  protocol: 'openai-completions',
  baseURL: 'http://127.0.0.1:11434/v1',
  models: [{ id: 'qwen3-8b', name: 'Qwen3 8B' }],
}

function customGroup(
  providerId: string,
  fields: CustomProviderFields,
): CatalogGroupView {
  return {
    providerId,
    providerName: fields.displayName,
    models: fields.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      efforts: [],
    })),
  }
}

export function modelSettingsFixtureSnapshot(): ModelSettingsSnapshot {
  const providers: ModelProviderView[] = [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      kind: 'builtin',
      active: true,
      configured: true,
      settingsWritable: true,
      credential: { kind: 'missing', writable: true },
      sharesKeyWith: [],
      revision: 1,
    },
    {
      id: 'local-compatible',
      name: SAMPLE_CUSTOM.displayName,
      kind: 'custom',
      active: true,
      configured: true,
      settingsWritable: true,
      credential: { kind: 'configured', source: 'stored', writable: true },
      sharesKeyWith: [],
      revision: 1,
      custom: SAMPLE_CUSTOM,
    },
    catalogRoute('openai', 'OpenAI'),
    catalogRoute('xiaomi-token-plan-cn', '小米 Token Plan（中国）'),
    catalogRoute('moonshotai', 'Moonshot AI'),
  ]
  const snapshot: Omit<ModelSettingsSnapshot, 'status'> = {
    generation: GENERATION,
    settingsWritable: true,
    providers,
    protocols: PROTOCOLS,
    catalog: [
      {
        providerId: 'deepseek-official',
        providerName: 'DeepSeek',
        models: deepseekModels,
      },
      customGroup('local-compatible', SAMPLE_CUSTOM),
    ],
    catalogFailures: 0,
    defaultModel: {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      reasoningEffort: 'high',
    },
    defaultRevision: 1,
    customRevision: 1,
  }
  return { ...snapshot, status: statusOf(snapshot) }
}

function statusOf(
  snapshot: Omit<ModelSettingsSnapshot, 'status'>,
): ModelStatusView {
  const view = (
    status: ModelStatusView['status'],
    reason: ModelStatusView['reason'],
  ): ModelStatusView => ({ status, reason, devOverride: false })
  const selection = snapshot.defaultModel
  if (!selection) return view('needs_configuration', 'no_default')
  const group = snapshot.catalog.find(
    (entry) => entry.providerId === selection.provider,
  )
  if (!group?.models.some((model) => model.id === selection.model))
    return view('needs_configuration', 'default_not_in_catalog')
  const provider = snapshot.providers.find(
    (entry) => entry.id === selection.provider,
  )
  if (!provider?.active) return view('unavailable', 'provider_inactive')
  if (provider.credential.kind === 'missing')
    return view('needs_configuration', 'credential_missing')
  return view('available', 'configured')
}

const failure = (code: ModelSettingsErrorCode): Result => ({
  ok: false,
  error: { code },
})

const validFields = (
  fields: CustomProviderFields,
  protocols: readonly string[],
): boolean => {
  const ids = fields.models.map((model) => model.id)
  return (
    fields.displayName.trim().length > 0 &&
    protocols.includes(fields.protocol) &&
    isHttpUrl(fields.baseURL) &&
    ids.length > 0 &&
    new Set(ids).size === ids.length
  )
}

/**
 * Labelled in-memory stand-in for Main's model settings. It keeps only
 * redacted facts: a submitted key flips the credential to `stored` and is
 * dropped; it is never assigned, copied or echoed anywhere.
 */
export class ModelSettingsFixture implements ModelSettingsPort {
  readonly label = 'fixture' as const
  #snapshot: ModelSettingsSnapshot
  readonly #latencyMs: number

  constructor(
    snapshot: ModelSettingsSnapshot = modelSettingsFixtureSnapshot(),
    options: ModelSettingsFixtureOptions = {},
  ) {
    this.#snapshot = snapshot
    this.#latencyMs = options.latencyMs ?? 0
  }

  async status(): Promise<ModelStatusView> {
    await this.#settle()
    return this.#snapshot.status
  }

  async read(): Promise<Result> {
    await this.#settle()
    return { ok: true, value: this.#snapshot }
  }

  async setProviderKey(command: SetProviderKeyCommand): Promise<Result> {
    await this.#settle()
    const found = this.#provider(command.generation, command.providerId)
    if (!found.ok) return found
    const provider = found.value
    if (provider.revision !== command.revision) return failure('conflict')
    if (!provider.settingsWritable || !credentialWritable(provider))
      return failure('read_only')
    if (apiKeyProblem(command.key.trim()) !== null)
      return failure('invalid_input')
    const routable =
      provider.kind !== 'catalog' || provider.id in CATALOG_MODELS
    return this.#commit({
      providers: this.#replace({
        ...provider,
        active: provider.active || routable,
        configured: true,
        credential: { kind: 'configured', source: 'stored', writable: true },
        revision: provider.revision + 1,
      }),
      catalog: this.#withCatalogGroup(provider),
    })
  }

  async clearProviderKey(command: ClearProviderKeyCommand): Promise<Result> {
    await this.#settle()
    const found = this.#provider(command.generation, command.providerId)
    if (!found.ok) return found
    const provider = found.value
    if (provider.credential.kind !== 'configured') return failure('rejected')
    if (!provider.credential.writable) return failure('read_only')
    const catalog = provider.kind === 'catalog'
    return this.#commit({
      providers: this.#replace({
        ...provider,
        active: catalog ? false : provider.active,
        credential: { kind: 'missing', writable: true },
        revision: provider.revision + 1,
      }),
      catalog: catalog
        ? this.#snapshot.catalog.filter(
            (group) => group.providerId !== provider.id,
          )
        : this.#snapshot.catalog,
    })
  }

  async saveCustomProvider(
    command: SaveCustomProviderCommand,
  ): Promise<Result> {
    await this.#settle()
    if (command.generation !== this.#snapshot.generation)
      return failure('stale_generation')
    if (!this.#snapshot.settingsWritable) return failure('read_only')
    if (!validFields(command.fields, this.#snapshot.protocols))
      return failure('invalid_input')
    const key = command.key?.trim() ?? ''
    if (key.length > 0 && apiKeyProblem(key) !== null)
      return failure('invalid_input')
    const existing = this.#snapshot.providers.find(
      (provider) => provider.id === command.providerId,
    )
    switch (command.mode) {
      case 'create': {
        if (!CUSTOM_ROUTE_PATTERN.test(command.providerId))
          return failure('invalid_input')
        if (existing) return failure('provider_exists')
        const created: ModelProviderView = {
          id: command.providerId,
          name: command.fields.displayName,
          kind: 'custom',
          active: key.length > 0,
          configured: true,
          settingsWritable: true,
          credential:
            key.length > 0
              ? { kind: 'configured', source: 'stored', writable: true }
              : { kind: 'missing', writable: true },
          sharesKeyWith: [],
          revision: 1,
          custom: command.fields,
        }
        return this.#commit({
          providers: [...this.#snapshot.providers, created],
          catalog: [
            ...this.#snapshot.catalog,
            customGroup(created.id, command.fields),
          ],
        })
      }
      case 'update': {
        if (!existing) return failure('unknown_provider')
        if (existing.kind !== 'custom') return failure('unsupported_provider')
        if (existing.revision !== command.revision) return failure('conflict')
        const credential =
          key.length > 0
            ? ({
                kind: 'configured',
                source: 'stored',
                writable: true,
              } as const)
            : existing.credential
        return this.#commit({
          providers: this.#replace({
            ...existing,
            name: command.fields.displayName,
            active: existing.active || key.length > 0,
            credential,
            revision: existing.revision + 1,
            custom: command.fields,
          }),
          catalog: this.#snapshot.catalog.map((group) =>
            group.providerId === existing.id
              ? customGroup(existing.id, command.fields)
              : group,
          ),
        })
      }
      default: {
        const unreachable: never = command.mode
        throw new Error(`Unknown save mode ${String(unreachable)}`)
      }
    }
  }

  async removeCustomProvider(
    command: RemoveCustomProviderCommand,
  ): Promise<Result> {
    await this.#settle()
    const found = this.#provider(command.generation, command.providerId)
    if (!found.ok) return found
    const provider = found.value
    if (provider.kind !== 'custom') return failure('unsupported_provider')
    if (!provider.settingsWritable) return failure('read_only')
    if (provider.revision !== command.revision) return failure('conflict')
    return this.#commit({
      providers: this.#snapshot.providers.filter(
        (entry) => entry.id !== provider.id,
      ),
      catalog: this.#snapshot.catalog.filter(
        (group) => group.providerId !== provider.id,
      ),
    })
  }

  async setDefaultModel(command: SetDefaultModelCommand): Promise<Result> {
    await this.#settle()
    if (command.generation !== this.#snapshot.generation)
      return failure('stale_generation')
    if (!this.#snapshot.settingsWritable) return failure('read_only')
    if (command.revision !== this.#snapshot.defaultRevision)
      return failure('conflict')
    const { selection } = command
    const model = this.#snapshot.catalog
      .find((group) => group.providerId === selection.provider)
      ?.models.find((entry) => entry.id === selection.model)
    if (!model) return failure('model_not_in_catalog')
    const effort = selection.reasoningEffort
    if (effort !== undefined && !model.efforts.includes(effort))
      return failure('invalid_input')
    return this.#commit({
      defaultModel: selection,
      defaultRevision: this.#snapshot.defaultRevision + 1,
    })
  }

  #provider(
    generation: number,
    providerId: string,
  ): ModelSettingsResult<ModelProviderView> {
    if (generation !== this.#snapshot.generation)
      return { ok: false, error: { code: 'stale_generation' } }
    const provider = this.#snapshot.providers.find(
      (entry) => entry.id === providerId,
    )
    return provider
      ? { ok: true, value: provider }
      : { ok: false, error: { code: 'unknown_provider' } }
  }

  #replace(provider: ModelProviderView): readonly ModelProviderView[] {
    return this.#snapshot.providers.map((entry) =>
      entry.id === provider.id ? provider : entry,
    )
  }

  #withCatalogGroup(provider: ModelProviderView): readonly CatalogGroupView[] {
    const models = CATALOG_MODELS[provider.id]
    const listed = this.#snapshot.catalog.some(
      (group) => group.providerId === provider.id,
    )
    if (listed || provider.kind !== 'catalog' || !models)
      return this.#snapshot.catalog
    return [
      ...this.#snapshot.catalog,
      { providerId: provider.id, providerName: provider.name, models },
    ]
  }

  #commit(patch: Partial<Omit<ModelSettingsSnapshot, 'status'>>): Result {
    const next = { ...this.#snapshot, ...patch }
    this.#snapshot = { ...next, status: statusOf(next) }
    return { ok: true, value: this.#snapshot }
  }

  #settle(): Promise<void> {
    return this.#latencyMs > 0
      ? new Promise((resolve) => setTimeout(resolve, this.#latencyMs))
      : Promise.resolve()
  }
}

function credentialWritable(provider: ModelProviderView): boolean {
  switch (provider.credential.kind) {
    case 'missing':
    case 'configured':
      return provider.credential.writable
    case 'not_required':
    case 'unknown':
      return false
    default: {
      const unreachable: never = provider.credential
      throw new Error(`Unknown credential ${JSON.stringify(unreachable)}`)
    }
  }
}
