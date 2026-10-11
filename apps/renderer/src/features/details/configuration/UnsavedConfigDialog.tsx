import { useState } from 'react'
import type { UnsavedConfigOverlay } from '../../../app/layout-state.ts'
import { Button } from '../../../shared/Button.tsx'
import { Dialog } from '../../../shared/Dialog.tsx'
import { useNotice } from '../../../shared/notice.tsx'
import { CONFIG_PAGE_CATALOG } from '../details-navigation.ts'
import {
  type ConfigDraftRegistry,
  leavesAfter,
  settlementNotice,
  settleUnsaved,
  type UnsavedChoice,
} from './config-drafts.ts'

interface UnsavedConfigDialogProps {
  readonly overlay: UnsavedConfigOverlay
  readonly drafts: ConfigDraftRegistry
  readonly onResolve: (leave: boolean) => void
}

/** 保存 / 放弃 / 取消 before leaving a configuration subpage with changes. */
export function UnsavedConfigDialog({
  overlay,
  drafts,
  onResolve,
}: UnsavedConfigDialogProps) {
  const notify = useNotice()
  const [saving, setSaving] = useState(false)
  const page = CONFIG_PAGE_CATALOG[overlay.page].label

  const choose = async (choice: UnsavedChoice) => {
    if (saving) return
    if (choice === 'save') setSaving(true)
    const settlement = await settleUnsaved(
      choice,
      drafts.find(overlay.botId, overlay.page),
    )
    setSaving(false)
    const notice = settlementNotice(settlement, page)
    if (notice !== null) notify(notice)
    onResolve(leavesAfter(settlement))
  }

  return (
    <Dialog
      busy={saving}
      size="sm"
      title={`“${page}”有未保存的修改`}
      description="离开前请选择：保存修改、放弃修改，或取消并留在当前页面。保存失败时修改会保留，不会离开。"
      onClose={() => void choose('cancel')}
      actions={
        <>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void choose('cancel')}
          >
            取消
          </Button>
          <Button disabled={saving} onClick={() => void choose('discard')}>
            放弃
          </Button>
          <Button
            variant="primary"
            pending={saving}
            onClick={() => void choose('save')}
          >
            {saving ? '正在保存…' : '保存'}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  )
}
