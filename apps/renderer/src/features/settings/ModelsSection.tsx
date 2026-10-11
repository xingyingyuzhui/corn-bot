import { useId, useReducer } from 'react'
import { useRepository, useWorkspace } from '../../app/workspace-context.tsx'
import { effectiveModel } from '../../model/models.ts'
import { needsModelWarning } from '../bot-editor/model-choice.ts'
import { SettingsRow } from './SettingsRow.tsx'
import {
  displayedValue,
  rowStatus,
  type SaveState,
  saveReducer,
} from './save-state.ts'

const UNSET = ''
const IDLE: SaveState<string> = { status: 'idle' }

export function ModelsSection() {
  const repository = useRepository()
  const { models } = useWorkspace()
  const labelId = useId()
  const selectId = useId()
  const [save, dispatch] = useReducer(saveReducer<string>, IDLE)

  const committed = models.globalDefault ?? UNSET
  const value = displayedValue(save, committed)
  const warning = needsModelWarning(
    effectiveModel({ modelOverride: null }, models),
    models,
  )

  const change = async (modelId: string) => {
    if (save.status === 'saving') return
    dispatch({ type: 'start', target: modelId })
    const result = await repository.setGlobalModel(modelId)
    dispatch(
      result.ok
        ? { type: 'succeed' }
        : { type: 'fail', message: result.error.message },
    )
  }

  return (
    <>
      {warning ? (
        <p className="corn-settings__warning" role="note">
          {warning}
        </p>
      ) : null}
      <div className="corn-settings__card">
        <SettingsRow
          label="全局默认模型"
          labelId={labelId}
          controlId={selectId}
          description="没有单独设置模型的 Bot 都用它。"
          status={rowStatus(save)}
          {...(save.status === 'error'
            ? { onRetry: () => void change(save.target) }
            : {})}
        >
          <select
            id={selectId}
            className="corn-settings__select"
            value={value}
            aria-busy={save.status === 'saving' || undefined}
            disabled={save.status === 'saving'}
            onChange={(event) => {
              if (event.target.value !== committed)
                void change(event.target.value)
            }}
          >
            {committed === UNSET ? (
              <option value={UNSET} disabled>
                请选择模型
              </option>
            ) : null}
            {models.catalog.map((entry) => (
              <option
                key={entry.id}
                value={entry.id}
                disabled={!entry.available}
              >
                {entry.available ? entry.label : `${entry.label}（不可用）`}
              </option>
            ))}
          </select>
        </SettingsRow>
      </div>

      <h3 className="corn-settings__subheading">模型目录</h3>
      <ul className="corn-settings__card corn-settings__catalog">
        {models.catalog.map((entry) => (
          <li key={entry.id} className="corn-settings__model">
            <span>
              {entry.label}
              <span className="corn-settings__model-provider">
                {entry.provider}
              </span>
            </span>
            <span
              className="corn-settings__model-state"
              data-available={entry.available}
            >
              {entry.available ? '可用' : '当前不可用'}
            </span>
          </li>
        ))}
      </ul>
      <p className="corn-settings__footnote">
        {repository.label === 'fixture'
          ? '模型目录是标注过的示例数据，M2 起读取 DSH modelCatalog。'
          : '模型目录来自 DSH modelCatalog。'}
        单个 Bot 可以在详情的「更多 → 模型」里单独设置，覆盖这里的默认值。
      </p>
    </>
  )
}
