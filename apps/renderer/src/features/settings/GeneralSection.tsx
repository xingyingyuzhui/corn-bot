import { useId, useState } from 'react'
import { useNotice } from '../../shared/notice.tsx'
import { UNAVAILABLE } from '../../shared/unavailable.ts'
import { OptionGroup } from './OptionGroup.tsx'
import { SettingsRow } from './SettingsRow.tsx'
import { rowStatus } from './save-state.ts'
import {
  APPEARANCE_OPTIONS,
  LANGUAGE_OPTIONS,
  M1_APPEARANCE,
  M1_LANGUAGE,
} from './settings-options.ts'

const IDLE = { status: 'idle' } as const

export function GeneralSection() {
  const notify = useNotice()
  const appearanceId = useId()
  const languageId = useId()
  const notificationsId = useId()
  const [appearance, setAppearance] = useState(M1_APPEARANCE)
  const [language, setLanguage] = useState(M1_LANGUAGE)

  return (
    <div className="corn-settings__card">
      <SettingsRow
        label="外观"
        labelId={appearanceId}
        description="M1 只提供浅色主题。"
        status={rowStatus(IDLE)}
      >
        <OptionGroup
          labelId={appearanceId}
          options={APPEARANCE_OPTIONS}
          value={appearance}
          onSelect={setAppearance}
        />
      </SettingsRow>
      <SettingsRow
        label="语言"
        labelId={languageId}
        description="界面、提示和无障碍标签使用同一种语言。"
        status={rowStatus(IDLE)}
      >
        <OptionGroup
          labelId={languageId}
          options={LANGUAGE_OPTIONS}
          value={language}
          onSelect={setLanguage}
        />
      </SettingsRow>
      <SettingsRow
        label="通知"
        labelId={notificationsId}
        description="Bot 完成任务或需要你确认时提醒你。"
        status={rowStatus(IDLE, UNAVAILABLE.notifications)}
      >
        <button
          type="button"
          role="switch"
          className="corn-switch"
          aria-checked={false}
          aria-labelledby={notificationsId}
          aria-disabled
          aria-description={UNAVAILABLE.notifications}
          title={`通知：${UNAVAILABLE.notifications}`}
          onClick={() => notify(UNAVAILABLE.notifications)}
        >
          <span className="corn-switch__thumb" aria-hidden />
        </button>
      </SettingsRow>
    </div>
  )
}
