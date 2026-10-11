import { AlertCircle, ArrowDown, Eye, LoaderCircle } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ChatScroll } from '../../app/layout-state.ts'
import type { BotView, ConversationView } from '../../model/workspace.ts'
import { ApprovalCard } from './ApprovalCard.tsx'
import { READ_ONLY_LABEL } from './composer-model.ts'
import { HandoffNotice } from './HandoffNotice.tsx'
import { MessageBubble } from './MessageBubble.tsx'
import { followDecision } from './transcript-model.ts'

const FOLLOW_THRESHOLD = 24

const scrollToEnd = (element: HTMLElement | null) => {
  if (element) element.scrollTop = element.scrollHeight
}

interface MessageFeedProps {
  readonly bots: Readonly<Record<string, BotView>>
  readonly conversation: ConversationView
  readonly initialScroll: ChatScroll | undefined
  /** Changes each time the user sends from this Bot's composer. */
  readonly followToken: number
  readonly onScroll: (scroll: ChatScroll) => void
  readonly onOpenPermissions: () => void
}

/**
 * Mounted per Bot; restores that Bot's scroll or follows the newest message.
 * A reader scrolled into history is never pulled down by new entries.
 */
export function MessageFeed({
  bots,
  conversation,
  initialScroll,
  followToken,
  onScroll,
  onOpenPermissions,
}: MessageFeedProps) {
  const { botId, items } = conversation
  const viewport = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const restore = useRef(initialScroll)
  const pinned = useRef(initialScroll?.pinnedToBottom ?? true)
  const seen = useRef({ count: items.length, lastId: items.at(-1)?.id })
  const handledToken = useRef(followToken)
  const [newerBelow, setNewerBelow] = useState(false)

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

  const toLatest = () => {
    scrollToEnd(viewport.current)
    pinned.current = true
    setNewerBelow(false)
  }

  useLayoutEffect(() => {
    const lastId = items.at(-1)?.id
    const appended =
      items.length > seen.current.count && lastId !== seen.current.lastId
    seen.current = { count: items.length, lastId }
    const userSent = followToken !== handledToken.current
    handledToken.current = followToken
    const decision = followDecision({
      pinned: pinned.current,
      appended,
      userSent,
    })
    switch (decision) {
      case 'scroll-to-latest':
        scrollToEnd(viewport.current)
        pinned.current = true
        setNewerBelow(false)
        return
      case 'show-latest-button':
        setNewerBelow(true)
        return
      case 'stay':
        return
      default: {
        const unreachable: never = decision
        throw new Error(`Unknown follow decision ${String(unreachable)}`)
      }
    }
  }, [items, followToken])

  const report = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = viewport.current
      if (!element) return
      pinned.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <
        FOLLOW_THRESHOLD
      if (pinned.current) setNewerBelow(false)
      onScroll({ top: element.scrollTop, pinnedToBottom: pinned.current })
    })
  }

  return (
    <div className="corn-feed-frame">
      <div
        ref={viewport}
        className="corn-feed"
        role="log"
        aria-live="polite"
        aria-busy={conversation.state === 'loading' || undefined}
        onScroll={report}
      >
        {conversation.readOnly ? (
          <p className="corn-feed__state" data-tone="muted">
            <Eye size={13} strokeWidth={2} aria-hidden />
            {READ_ONLY_LABEL}
          </p>
        ) : null}
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
                  botId={botId}
                  id={item.id}
                  author={item.author}
                  paragraphs={item.paragraphs}
                  attachments={item.attachments}
                  delivery={item.delivery}
                  failure={item.failure}
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
            case 'notice':
              return (
                <p
                  key={item.id}
                  className="corn-feed__notice"
                  data-tone={item.tone}
                >
                  {item.tone === 'error' ? (
                    <AlertCircle size={13} strokeWidth={2} aria-hidden />
                  ) : null}
                  {item.tone === 'error' ? (
                    <span className="corn-visually-hidden">错误：</span>
                  ) : null}
                  {item.text}
                </p>
              )
            case 'approval':
              return (
                <ApprovalCard
                  key={item.id}
                  botId={botId}
                  requestId={item.requestId}
                  title={item.title}
                  detail={item.detail}
                  status={item.status}
                  onOpenPermissions={onOpenPermissions}
                />
              )
            default: {
              const unreachable: never = item
              throw new Error(
                `Unknown feed item ${JSON.stringify(unreachable)}`,
              )
            }
          }
        })}
        <ConversationStatus state={conversation.state} />
      </div>
      {newerBelow ? (
        <button type="button" className="corn-feed__latest" onClick={toLatest}>
          <ArrowDown size={14} strokeWidth={2} aria-hidden />
          回到最新
        </button>
      ) : null}
    </div>
  )
}

function ConversationStatus({
  state,
}: {
  readonly state: ConversationView['state']
}) {
  switch (state) {
    case 'ready':
      return null
    case 'loading':
      return (
        <p className="corn-feed__state" role="status">
          <LoaderCircle
            className="corn-feed__spin"
            size={14}
            strokeWidth={2}
            aria-hidden
          />
          正在加载对话…
        </p>
      )
    case 'error':
      return (
        <p className="corn-feed__state" data-tone="error" role="alert">
          <AlertCircle size={14} strokeWidth={2} aria-hidden />
          对话加载失败，暂时无法显示消息
        </p>
      )
    default: {
      const unreachable: never = state
      throw new Error(`Unknown conversation state ${String(unreachable)}`)
    }
  }
}
