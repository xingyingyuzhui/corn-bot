import type { SettingsSection } from '../../app/layout-state.ts'
import { UNAVAILABLE } from '../../shared/unavailable.ts'

export interface SettingsOption<T extends string> {
  readonly value: T
  readonly label: string
  /** Visible but not selectable yet; selecting announces this reason. */
  readonly unavailable?: string
}

export type Appearance = 'system' | 'light' | 'dark'
export type Language = 'zh-CN' | 'zh-TW' | 'en'

export const APPEARANCE_OPTIONS: readonly SettingsOption<Appearance>[] = [
  { value: 'system', label: '系统', unavailable: UNAVAILABLE.darkTheme },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色', unavailable: UNAVAILABLE.darkTheme },
]

export const LANGUAGE_OPTIONS: readonly SettingsOption<Language>[] = [
  { value: 'zh-CN', label: '简体中文' },
  {
    value: 'zh-TW',
    label: '繁體中文',
    unavailable: UNAVAILABLE.otherLanguages,
  },
  { value: 'en', label: 'English', unavailable: UNAVAILABLE.otherLanguages },
]

/** M1 ships the light theme and Simplified Chinese only. */
export const M1_APPEARANCE: Appearance = 'light'
export const M1_LANGUAGE: Language = 'zh-CN'

export const SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
  general: '通用',
  models: '模型',
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'models',
]

/** Selecting an option either changes the value or explains why it cannot. */
export function chooseOption<T extends string>(
  options: readonly SettingsOption<T>[],
  value: T,
):
  | { readonly kind: 'select'; readonly value: T }
  | { readonly kind: 'explain'; readonly reason: string } {
  const option = options.find((entry) => entry.value === value)
  if (!option) return { kind: 'explain', reason: '这个选项不存在' }
  return option.unavailable
    ? { kind: 'explain', reason: option.unavailable }
    : { kind: 'select', value }
}
