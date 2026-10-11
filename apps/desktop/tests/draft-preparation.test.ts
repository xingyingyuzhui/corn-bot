import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContext, runInContext } from 'node:vm'
import {
  COMPOSER_FIELD,
  type DraftPreparation,
  draftPreparationScript,
  isDraftPreparation,
} from '../src/smoke/draft-preparation.ts'

class FakeEvent {
  readonly type: string
  readonly bubbles: boolean
  target: FakeElement | null = null
  constructor(type: string, init: { bubbles?: boolean } = {}) {
    this.type = type
    this.bubbles = init.bubbles ?? false
  }
}

type Listener = (event: FakeEvent) => void

class FakeElement {
  parent: FakeElement | null = null
  readOnly = false
  disabled = false
  readonly #listeners = new Map<string, Listener[]>()
  addEventListener(type: string, listener: Listener) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }
  dispatchEvent(event: FakeEvent): boolean {
    event.target = this
    for (
      let node: FakeElement | null = this;
      node;
      node = event.bubbles ? node.parent : null
    )
      for (const listener of node.#listeners.get(event.type) ?? [])
        listener(event)
    return true
  }
}

/** Stands in for the native prototype accessor that React's tracker bypasses. */
function nativeValue(target: { prototype: object }) {
  const stored = new WeakMap<object, string>()
  Object.defineProperty(target.prototype, 'value', {
    configurable: true,
    get(this: object) {
      return stored.get(this) ?? ''
    },
    set(this: object, value: unknown) {
      stored.set(this, String(value))
    },
  })
}

class FakeTextArea extends FakeElement {}
class FakeInput extends FakeElement {}
nativeValue(FakeTextArea)
nativeValue(FakeInput)

const DRAFT = '切换详情后草稿仍在'

/**
 * Minimal controlled-field model of React: an instance `value` property that
 * tracks writes made through it, a root `input` listener that reports a change
 * only when the native value differs from the tracked one, and a re-render that
 * writes component state back to the field.
 */
function controlledComposer(
  field: FakeElement,
  { acceptChange = true }: { readonly acceptChange?: boolean } = {},
) {
  const root = new FakeElement()
  field.parent = root
  const native = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    'value',
  )
  assert.ok(native?.get && native.set)
  const read = native.get
  const write = native.set
  let tracked = ''
  let state = ''
  let changes = 0
  Object.defineProperty(field, 'value', {
    configurable: true,
    get() {
      return read.call(field)
    },
    set(value: unknown) {
      tracked = String(value)
      write.call(field, value)
    },
  })
  const controlled = field as FakeElement & { value: string }
  const render = () => {
    if (controlled.value !== state) controlled.value = state
  }
  root.addEventListener('input', (event) => {
    const current = read.call(event.target)
    if (current !== tracked) {
      tracked = current
      changes++
      if (acceptChange) state = current
    }
    setTimeout(render, 0)
  })
  return {
    field: controlled,
    state: () => state,
    changes: () => changes,
    render,
  }
}

function page(field: FakeElement | null) {
  return createContext({
    document: {
      querySelector: (selector: string) =>
        selector === COMPOSER_FIELD ? field : null,
    },
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: FakeInput,
    Event: FakeEvent,
    setTimeout,
    Date,
  })
}

async function prepare(
  field: FakeElement | null,
  text = DRAFT,
  deadlineMs?: number,
): Promise<DraftPreparation> {
  const result: unknown = await runInContext(
    draftPreparationScript(
      text,
      deadlineMs === undefined ? {} : { deadlineMs },
    ),
    page(field),
  )
  // `executeJavaScript` structured-clones the page result into Main's realm.
  const cloned: unknown = structuredClone(result)
  assert.ok(isDraftPreparation(cloned), 'malformed preparation result')
  return cloned
}

test('background layout probe draft preparation: the input event updates controlled state', async () => {
  for (const element of [new FakeTextArea(), new FakeInput()]) {
    const composer = controlledComposer(element)
    assert.deepEqual(await prepare(element), { ok: true })
    assert.equal(composer.changes(), 1)
    assert.equal(composer.state(), DRAFT)
    composer.render()
    assert.equal(composer.field.value, DRAFT)
  }
})

test('background layout probe draft preparation: a DOM-only value is not accepted as a draft', async () => {
  const domOnly = controlledComposer(new FakeTextArea())
  domOnly.field.value = DRAFT
  domOnly.field.dispatchEvent(new FakeEvent('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(domOnly.changes(), 0)
  assert.equal(domOnly.field.value, '')

  const ignored = controlledComposer(new FakeTextArea(), {
    acceptChange: false,
  })
  const result = await prepare(ignored.field, DRAFT, 100)
  assert.equal(result.ok, false)
  assert.match(
    result.ok ? '' : result.error,
    /^draft preparation: composer did not keep the draft/u,
  )
  assert.equal(ignored.state(), '')
})

test('background layout probe draft preparation: missing, non-text and read-only targets fail explicitly', async () => {
  const readOnly = new FakeTextArea()
  readOnly.readOnly = true
  for (const [target, reason] of [
    [null, 'composer field missing'],
    [new FakeElement(), 'composer field is not a text control'],
    [readOnly, 'composer field is read-only'],
  ] as const)
    assert.deepEqual(await prepare(target), {
      ok: false,
      error: `draft preparation: ${reason}`,
    })
})

test('background layout probe draft preparation: the draft is passed as data, not source', async () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal placeholder must stay inert data
  const hostile = '引号 \' " ` ${globalThis.x} </script>\n\\u0000 \u2028 end'
  const composer = controlledComposer(new FakeTextArea())
  assert.deepEqual(await prepare(composer.field, hostile), { ok: true })
  assert.equal(composer.state(), hostile)
  assert.ok(draftPreparationScript(hostile).includes(JSON.stringify(hostile)))
})

test('background layout probe draft preparation: result shape guard', () => {
  assert.equal(isDraftPreparation({ ok: true }), true)
  assert.equal(isDraftPreparation({ ok: false, error: 'x' }), true)
  for (const value of [null, 'ok', {}, { ok: false }, { ok: 1 }])
    assert.equal(isDraftPreparation(value), false)
})
