import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface RosterSearchFieldProps {
  readonly query: string
  /** True only for a focus request the roster has not handled yet; a remount
   * (rail toggle, auto-compact) must not pull focus from elsewhere. */
  readonly focusPending: boolean
  readonly onFocused: () => void
  readonly onQuery: (query: string) => void
  readonly onClose: () => void
}

export const ROSTER_SEARCH_ID = 'corn-roster-search'
export const ROSTER_RESULTS_ID = 'corn-roster-results'

/** Inline filter; Escape clears and closes in one step. */
export function RosterSearchField({
  query,
  focusPending,
  onFocused,
  onQuery,
  onClose,
}: RosterSearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focusPending) return
    input.current?.focus()
    input.current?.select()
    onFocused()
  }, [focusPending, onFocused])

  return (
    <search className="corn-roster-search">
      <Search
        className="corn-roster-search__icon"
        size={14}
        strokeWidth={2}
        aria-hidden
      />
      <input
        ref={input}
        id={ROSTER_SEARCH_ID}
        type="search"
        className="corn-roster-search__input"
        value={query}
        placeholder="搜索名称、职责或标签"
        aria-label="搜索 Bot"
        aria-controls={ROSTER_RESULTS_ID}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      />
      <button
        type="button"
        className="corn-roster-search__close"
        aria-label="关闭搜索"
        title="关闭搜索"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} aria-hidden />
      </button>
    </search>
  )
}
