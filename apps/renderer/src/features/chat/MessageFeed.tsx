import { useLayoutEffect, useRef } from 'react'
import type { ChatScroll } from '../../app/layout-state.ts'
import type { BotView, FeedItem } from '../../model/workspace.ts'
import { HandoffNotice } from './HandoffNotice.tsx'
import { MessageBubble } from './MessageBubble.tsx'

const FOLLOW_THRESHOLD = 24

interface MessageFeedProps {
  readonly bots: Readonly<Record<string, BotView>>
  readonly items: readonly FeedItem[]
  readonly notice: string
  readonly initialScroll: ChatScroll | undefined
  readonly onScroll: (scroll: ChatScroll) => void
}

/** Mounted per Bot; restores that Bot's scroll or follows the newest message. */
export function MessageFeed({
  bots,
  items,
  notice,
  initialScroll,
  onScroll,
}: MessageFeedProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const restore = useRef(initialScroll)
  const pinned = useRef(initialScroll?.pinnedToBottom ?? true)

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const saved = restore.current
    element.scrollTop =
      saved && !saved.pinnedToBottom ? saved.top : element.scrollHeight
    const follow = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight
    })
    follow.observe(element)
    return () => {
      follow.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [])

  const report = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = viewport.current
      if (!element) return
      pinned.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <
        FOLLOW_THRESHOLD
      onScroll({ top: element.scrollTop, pinnedToBottom: pinned.current })
    })
  }

  return (
    <div
      ref={viewport}
      className="corn-feed"
      role="log"
      aria-live="polite"
      onScroll={report}
    >
      <p className="corn-feed__notice">{notice}</p>
      {items.map((item) => {
        switch (item.kind) {
          case 'divider':
            return (
              <p key={item.id} className="corn-feed__divider">
                {item.label}
              </p>
            )
          case 'message':
            return (
              <MessageBubble
                key={item.id}
                author={item.author}
                paragraphs={item.paragraphs}
              />
            )
          case 'attachment-placeholder':
            return (
              <div
                key={item.id}
                className="corn-feed__attachment"
                data-author={item.author}
                role="img"
                aria-label="图片附件（示例占位）"
                style={{ inlineSize: item.width, blockSize: item.height }}
              />
            )
          case 'handoff':
            return (
              <HandoffNotice key={item.id} bots={bots} botIds={item.botIds} />
            )
          default: {
            const unreachable: never = item
            throw new Error(`Unknown feed item ${JSON.stringify(unreachable)}`)
          }
        }
      })}
    </div>
  )
}
