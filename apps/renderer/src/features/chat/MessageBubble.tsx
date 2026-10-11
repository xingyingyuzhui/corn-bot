interface MessageBubbleProps {
  readonly author: 'user' | 'bot'
  readonly paragraphs: readonly string[]
}

export function MessageBubble({ author, paragraphs }: MessageBubbleProps) {
  return (
    <div className="corn-bubble" data-author={author} data-selectable>
      {paragraphs.map((text, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are immutable and may repeat
        <p key={index}>{text}</p>
      ))}
    </div>
  )
}
