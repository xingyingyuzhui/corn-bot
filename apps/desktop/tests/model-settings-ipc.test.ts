import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import {
  MODEL_SETTINGS_CHANNELS,
  type ModelSettingsResult,
  type ModelSettingsSnapshot,
} from '../../../packages/contracts/src/model-settings.ts'
import { registerModelSettingsIpc } from '../src/ipc/model-settings.ts'

const FAKE_KEY = 'sk-corn-wp3-FAKE-0000'
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type Result = ModelSettingsResult<ModelSettingsSnapshot>

const SNAPSHOT = { generation: 1 } as ModelSettingsSnapshot

function setup() {
  const handlers = new Map<string, Handler>()
  const mainFrame = {}
  const webContents = { mainFrame }
  const window = { webContents } as BrowserWindow
  const received: Array<[string, unknown]> = []
  const answer =
    (name: string) =>
    async (command?: unknown): Promise<Result> => {
      received.push([name, command])
      return { ok: true, value: SNAPSHOT }
    }
  const service = {
    status: () =>
      ({ status: 'checking', reason: 'reading', devOverride: false }) as const,
    read: answer('read'),
    setProviderKey: answer('setProviderKey'),
    clearProviderKey: answer('clearProviderKey'),
    saveCustomProvider: answer('saveCustomProvider'),
    removeCustomProvider: answer('removeCustomProvider'),
    setDefaultModel: answer('setDefaultModel'),
  }
  registerModelSettingsIpc(
    {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      },
    } as never,
    window,
    service,
  )
  const trusted = { sender: webContents, senderFrame: mainFrame } as never
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    assert.ok(handler, channel)
    return handler(trusted, ...args)
  }
  return { handlers, invoke, received, service, webContents, mainFrame }
}

const VALID: Record<string, unknown> = {
  [MODEL_SETTINGS_CHANNELS.setProviderKey]: {
    generation: 1,
    providerId: 'deepseek-official',
    revision: 0,
    key: FAKE_KEY,
  },
  [MODEL_SETTINGS_CHANNELS.clearProviderKey]: {
    generation: 1,
    providerId: 'deepseek-official',
  },
  [MODEL_SETTINGS_CHANNELS.saveCustomProvider]: {
    generation: 1,
    mode: 'create',
    providerId: 'corn-gw',
    revision: 0,
    fields: {
      displayName: 'Corn',
      protocol: 'openai-completions',
      baseURL: 'https://example.invalid/v1',
      models: [{ id: 'm1' }],
    },
  },
  [MODEL_SETTINGS_CHANNELS.removeCustomProvider]: {
    generation: 1,
    providerId: 'corn-gw',
    revision: 0,
  },
  [MODEL_SETTINGS_CHANNELS.setDefaultModel]: {
    generation: 1,
    revision: 0,
    selection: { provider: 'deepseek-official', model: 'deepseek-flash' },
  },
}

test('the sandboxed preload exposes exactly the contract channels', async () => {
  const preload = await readFile(
    new URL('../src/preload.cts', import.meta.url),
    'utf8',
  )
  const channels = [...preload.matchAll(/'(corn:[a-z:-]+)'/gu)].map(
    (match) => match[1],
  )
  assert.deepEqual(
    channels.toSorted(),
    [
      'corn:runtime:status',
      ...Object.values(MODEL_SETTINGS_CHANNELS),
    ].toSorted(),
  )
  for (const method of Object.keys(MODEL_SETTINGS_CHANNELS))
    assert.match(preload, new RegExp(`\\b${method}: `, 'u'))
  assert.doesNotMatch(preload, /ipcRenderer\.(send|on|sendSync)\b/u)
  const { handlers } = setup()
  assert.deepEqual(
    [...handlers.keys()].toSorted(),
    Object.values(MODEL_SETTINGS_CHANNELS).toSorted(),
  )
})

test('every channel rejects another window and nested frames before the service runs', async () => {
  const { handlers, received, webContents, mainFrame } = setup()
  for (const [channel, handler] of handlers)
    for (const event of [
      { sender: { mainFrame }, senderFrame: mainFrame },
      { sender: webContents, senderFrame: {} },
    ])
      await assert.rejects(
        async () => handler(event as never, VALID[channel]),
        /Untrusted/u,
        channel,
      )
  assert.deepEqual(received, [])
})

test('commands are strict: no extra keys, refs, namespaces, paths or arguments', async () => {
  const { invoke, received } = setup()
  const invalid = { ok: false, error: { code: 'invalid_input' } }
  const cases: Array<[string, unknown[]]> = [
    [MODEL_SETTINGS_CHANNELS.read, [{}]],
    [
      MODEL_SETTINGS_CHANNELS.setProviderKey,
      [
        {
          ...(VALID[MODEL_SETTINGS_CHANNELS.setProviderKey] as object),
          ref: 'X',
        },
      ],
    ],
    [
      MODEL_SETTINGS_CHANNELS.setProviderKey,
      [
        {
          ...(VALID[MODEL_SETTINGS_CHANNELS.setProviderKey] as object),
          key: ' ',
        },
      ],
    ],
    [
      MODEL_SETTINGS_CHANNELS.setProviderKey,
      [
        {
          ...(VALID[MODEL_SETTINGS_CHANNELS.setProviderKey] as object),
          key: 'DEEPSEEK_API_KEY=sk-x',
        },
      ],
    ],
    [
      MODEL_SETTINGS_CHANNELS.setProviderKey,
      [VALID[MODEL_SETTINGS_CHANNELS.setProviderKey], 'extra'],
    ],
    [
      MODEL_SETTINGS_CHANNELS.clearProviderKey,
      [{ generation: 1, providerId: 'deepseek-official', ns: 'llm-deepseek' }],
    ],
    [
      MODEL_SETTINGS_CHANNELS.saveCustomProvider,
      [
        {
          ...(VALID[MODEL_SETTINGS_CHANNELS.saveCustomProvider] as object),
          providerId: 'Bad Route',
        },
      ],
    ],
    [
      MODEL_SETTINGS_CHANNELS.saveCustomProvider,
      [
        {
          ...(VALID[MODEL_SETTINGS_CHANNELS.saveCustomProvider] as object),
          path: ['providers'],
        },
      ],
    ],
    [
      MODEL_SETTINGS_CHANNELS.removeCustomProvider,
      [{ generation: '1', providerId: 'corn-gw', revision: 0 }],
    ],
    [
      MODEL_SETTINGS_CHANNELS.setDefaultModel,
      [
        {
          generation: 1,
          revision: 0,
          selection: { provider: 'p', model: 'm', settingsNs: 'x' },
        },
      ],
    ],
    [MODEL_SETTINGS_CHANNELS.setDefaultModel, [null]],
  ]
  for (const [channel, args] of cases)
    assert.deepEqual(await invoke(channel, ...args), invalid, channel)
  assert.deepEqual(received, [])
})

test('valid commands reach the service once; a thrown error becomes host_error with no message', async () => {
  const { invoke, received, service } = setup()
  for (const [channel, payload] of Object.entries(VALID))
    assert.deepEqual(await invoke(channel, payload), {
      ok: true,
      value: SNAPSHOT,
    })
  assert.deepEqual(await invoke(MODEL_SETTINGS_CHANNELS.read), {
    ok: true,
    value: SNAPSHOT,
  })
  assert.deepEqual(
    received.map(([name]) => name),
    [
      'setProviderKey',
      'clearProviderKey',
      'saveCustomProvider',
      'removeCustomProvider',
      'setDefaultModel',
      'read',
    ],
  )
  service.setProviderKey = async () => {
    throw new Error(`exploded with ${FAKE_KEY}`)
  }
  const reply = await invoke(
    MODEL_SETTINGS_CHANNELS.setProviderKey,
    VALID[MODEL_SETTINGS_CHANNELS.setProviderKey],
  )
  assert.deepEqual(reply, { ok: false, error: { code: 'host_error' } })
  assert.deepEqual(await invoke(MODEL_SETTINGS_CHANNELS.status), {
    status: 'checking',
    reason: 'reading',
    devOverride: false,
  })
})
