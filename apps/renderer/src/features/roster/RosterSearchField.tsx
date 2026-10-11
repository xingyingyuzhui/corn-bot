import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface RosterSearchFieldProps {
  readonly query: string
  readonly focusRequest: number
  readonly onQuery: (query: string) => void
  readonly onClose: () => void
}

export const ROSTER_SEARCH_ID = 'corn-roster-search'

/** Inline filter; Escape clears and closes in one step. */
export function RosterSearchField({
  query,
  focusRequest,
  onQuery,
  onClose,
}: RosterSearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusRequest === 0) return
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])

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
        aria-controls="corn-roster-results"
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
