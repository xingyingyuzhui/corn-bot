import { Fragment, useId, useState } from 'react'
import { useWorkspace } from '../../app/workspace-context.tsx'
import { Button } from '../../shared/Button.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import { useNotice } from '../../shared/notice.tsx'
import { FormError, MissingBotDialog } from './EditorParts.tsx'
import { buildRestrictedExport } from './share-export.ts'

export interface ShareExportDialogProps {
  readonly botId: string
  readonly onClose: () => void
}

const TITLE = '导出受限配置'

export function ShareExportDialog({ botId, onClose }: ShareExportDialogProps) {
  const workspace = useWorkspace()
  const notify = useNotice()
  const [copyError, setCopyError] = useState<string | null>(null)
  const includedId = useId()
  const excludedId = useId()
  const bot = workspace.roster.bots[botId]
  if (!bot) return <MissingBotDialog title={TITLE} onClose={onClose} />
  const result = buildRestrictedExport(bot, workspace)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.json)
      notify('已复制')
      onClose()
    } catch {
      setCopyError('复制失败：系统剪贴板不可用，请稍后重试')
    }
  }

  return (
    <Dialog
      title={TITLE}
      description="导出前先确认内容。只会复制到剪贴板：不生成分享链接，不上传，不写入文件。"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void copy()}>
            复制配置
          </Button>
        </>
      }
    >
      <section className="corn-editor__section" aria-labelledby={includedId}>
        <h3 id={includedId} className="corn-editor__heading">
          包含的字段
        </h3>
        <dl className="corn-editor__fields">
          {result.included.map((field) => (
            <Fragment key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                {field.value || (
                  <span className="corn-editor__muted">（空）</span>
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
        {result.redactions > 0 ? (
          <p className="corn-editor__footnote">
            已从文本中移除 {result.redactions} 处本机路径或疑似密钥。
          </p>
        ) : null}
      </section>
      <section className="corn-editor__section" aria-labelledby={excludedId}>
        <h3 id={excludedId} className="corn-editor__heading">
          默认排除
        </h3>
        <ul className="corn-editor__excluded">
          {result.excluded.map((category) => (
            <li key={category.id}>
              <span>{category.label}</span>
              <span>{category.reason}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="corn-editor__section">
        <details className="corn-editor__preview">
          <summary>预览将复制的 JSON</summary>
          <pre>{result.json}</pre>
        </details>
      </section>
      <FormError message={copyError} />
    </Dialog>
  )
}
