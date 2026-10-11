import { useId } from 'react'
import { effectiveModel, needsModelWarning } from '../../model/models.ts'
import type { BotView, ModelSettings } from '../../model/workspace.ts'
import { EditorWarning } from './EditorParts.tsx'
import { modelChoices } from './model-choice.ts'

const FOLLOW_GLOBAL = ''

interface ModelChoiceFieldsProps {
  readonly bot: BotView
  readonly settings: ModelSettings
  readonly choice: string | null
  readonly onChoose: (choice: string | null) => void
  /** The editor's write is in flight. */
  readonly disabled?: boolean
}

/** Follow-global plus the catalog, with unavailable entries explained. */
export function ModelChoiceFields({
  bot,
  settings,
  choice,
  onChoose,
  disabled = false,
}: ModelChoiceFieldsProps) {
  const name = useId()
  const warning = needsModelWarning(effectiveModel(bot, settings), settings)
  return (
    <>
      {warning ? (
        <EditorWarning>
          <p className="corn-editor__warning-text">{warning}</p>
        </EditorWarning>
      ) : null}
      <fieldset
        className="corn-editor__options corn-editor__card"
        disabled={disabled}
      >
        <legend className="corn-visually-hidden">这个 Bot 使用的模型</legend>
        {modelChoices(settings).map((entry) => (
          <label
            key={entry.value ?? FOLLOW_GLOBAL}
            className="corn-editor__option"
            data-unavailable={entry.unavailable ? true : undefined}
          >
            <input
              type="radio"
              name={name}
              value={entry.value ?? FOLLOW_GLOBAL}
              checked={choice === entry.value}
              disabled={entry.unavailable !== undefined}
              onChange={() => onChoose(entry.value)}
            />
            <span>
              {entry.label}
              <span className="corn-editor__option-detail">
                {entry.unavailable
                  ? `${entry.detail} · ${entry.unavailable}`
                  : entry.detail}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  )
}
