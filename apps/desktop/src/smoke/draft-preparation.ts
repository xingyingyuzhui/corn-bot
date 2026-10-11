/**
 * Background layout probe draft preparation. Smoke windows are shown inactive
 * (`window-presentation.ts`), where `webContents.insertText` does not reach the
 * page, so the draft enters through the page instead: the element's native
 * prototype `value` setter (bypassing React's per-instance value tracker) plus
 * a bubbling `input` event, which React's own `onChange` handles. A controlled
 * field whose state did not take the draft is reset by React on the next
 * render, so the value is accepted only after it holds across consecutive
 * polls. This is not keyboard, IME or native focus coverage.
 */

export const COMPOSER_FIELD = '.corn-composer__field'
export const DRAFT_PREPARATION_DEADLINE_MS = 2_000
/** Consecutive polls the value must survive before it counts as committed. */
const STABLE_POLLS = 3
const POLL_MS = 50

export type DraftPreparation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

const PREPARE_DRAFT = `async (selector, text, deadlineMs, stablePolls, pollMs) => {
  const fail = (reason) => ({ ok: false, error: 'draft preparation: ' + reason })
  const field = document.querySelector(selector)
  if (!field) return fail('composer field missing')
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : field instanceof HTMLInputElement ? HTMLInputElement.prototype
    : null
  if (!prototype) return fail('composer field is not a text control')
  if (field.readOnly || field.disabled) return fail('composer field is read-only')
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) return fail('no native value setter')
  setter.call(field, text)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  const deadline = Date.now() + deadlineMs
  let held = 0
  while (held < stablePolls) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    const current = document.querySelector(selector)
    if (!current) return fail('composer field disappeared')
    held = current.value === text ? held + 1 : 0
    if (held < stablePolls && Date.now() > deadline)
      return fail('composer did not keep the draft before the deadline')
  }
  return { ok: true }
}`

/** The page script; every argument is passed as JSON data, never spliced as source. */
export function draftPreparationScript(
  text: string,
  {
    selector = COMPOSER_FIELD,
    deadlineMs = DRAFT_PREPARATION_DEADLINE_MS,
  }: { readonly selector?: string; readonly deadlineMs?: number } = {},
): string {
  const args = [selector, text, deadlineMs, STABLE_POLLS, POLL_MS]
    .map((value) => JSON.stringify(value))
    .join(', ')
  return `(${PREPARE_DRAFT})(${args})`
}

export function isDraftPreparation(value: unknown): value is DraftPreparation {
  if (typeof value !== 'object' || value === null || !('ok' in value))
    return false
  if (value.ok === true) return true
  return (
    value.ok === false && 'error' in value && typeof value.error === 'string'
  )
}
