import { useNotice } from '../../shared/notice.tsx'
import { chooseOption, type SettingsOption } from './settings-options.ts'

interface OptionGroupProps<T extends string> {
  readonly labelId: string
  readonly options: readonly SettingsOption<T>[]
  readonly value: T
  readonly onSelect: (value: T) => void
}

/** Segmented choice; unavailable options stay focusable and say why. */
export function OptionGroup<T extends string>({
  labelId,
  options,
  value,
  onSelect,
}: OptionGroupProps<T>) {
  const notify = useNotice()
  return (
    <fieldset className="corn-segmented" aria-labelledby={labelId}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="corn-segmented__item"
          aria-pressed={option.value === value}
          aria-disabled={option.unavailable ? true : undefined}
          aria-description={option.unavailable}
          title={
            option.unavailable
              ? `${option.label}：${option.unavailable}`
              : option.label
          }
          onClick={() => {
            const outcome = chooseOption(options, option.value)
            switch (outcome.kind) {
              case 'select':
                if (outcome.value !== value) onSelect(outcome.value)
                return
              case 'explain':
                notify(outcome.reason)
                return
              default: {
                const unreachable: never = outcome
                throw new Error(
                  `Unknown option outcome ${JSON.stringify(unreachable)}`,
                )
              }
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
