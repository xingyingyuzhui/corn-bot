import type { ApprovalStatus, DeliveryState } from '../../model/workspace.ts'

export type DeliveryAction = 'cancel' | 'resend'

export interface DeliveryLine {
  readonly text: string
  readonly tone: 'muted' | 'error'
  readonly actions: readonly DeliveryAction[]
}

/**
 * Delivery is Corn's side only: `accepted` means DSH took the message, not
 * that the Bot answered. A send already dispatching can no longer be cancelled.
 */
export function deliveryLine(
  delivery: DeliveryState,
  failure: string | undefined,
): DeliveryLine {
  switch (delivery) {
    case 'queued':
      return { text: '等待连接 Bot 后发送', tone: 'muted', actions: ['cancel'] }
    case 'dispatching':
      return { text: '正在发送…', tone: 'muted', actions: [] }
    case 'accepted':
      return { text: '已发送', tone: 'muted', actions: [] }
    case 'failed':
      return {
        text: failure ?? '发送失败',
        tone: 'error',
        actions: ['resend', 'cancel'],
      }
    default: {
      const unreachable: never = delivery
      throw new Error(`Unknown delivery ${String(unreachable)}`)
    }
  }
}

export type ApprovalCardView =
  | { readonly kind: 'pending'; readonly busy: boolean }
  | { readonly kind: 'settled'; readonly text: string }

export function approvalView(status: ApprovalStatus): ApprovalCardView {
  switch (status) {
    case 'pending':
      return { kind: 'pending', busy: false }
    case 'submitting':
      return { kind: 'pending', busy: true }
    case 'allowed-once':
      return { kind: 'settled', text: '已允许一次' }
    case 'rejected':
      return { kind: 'settled', text: '已拒绝' }
    case 'cancelled':
      return { kind: 'settled', text: '请求已失效' }
    default: {
      const unreachable: never = status
      throw new Error(`Unknown approval status ${String(unreachable)}`)
    }
  }
}

export interface FollowInput {
  /** The reader is at (or within a few px of) the newest message. */
  readonly pinned: boolean
  /** A new entry was appended after the last one the feed had drawn. */
  readonly appended: boolean
  /** The user just sent from this Bot's composer. */
  readonly userSent: boolean
}

export type FollowDecision = 'scroll-to-latest' | 'show-latest-button' | 'stay'

/** Never pull a reader away from history; only their own send moves them. */
export function followDecision(input: FollowInput): FollowDecision {
  if (input.userSent || input.pinned) return 'scroll-to-latest'
  return input.appended ? 'show-latest-button' : 'stay'
}
