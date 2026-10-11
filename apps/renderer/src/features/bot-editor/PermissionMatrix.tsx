import type { PermissionLevel, PermissionRow } from '../../model/workspace.ts'
import {
  enforcedLevel,
  exceedsCeiling,
  LEVEL_LABELS,
} from './permission-levels.ts'
import './editor-dialogs.css'

function Level({ level }: { readonly level: PermissionLevel }) {
  return (
    <span className="corn-editor__level" data-level={level}>
      {LEVEL_LABELS[level]}
    </span>
  )
}

/** Read-only capability matrix; the effective level never exceeds the ceiling. */
export function PermissionMatrix({
  rows,
}: {
  readonly rows: readonly PermissionRow[]
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className="corn-editor__empty">这个 Bot 还没有权限记录。</p>
      ) : (
        <table className="corn-editor__table">
          <caption className="corn-visually-hidden">权限矩阵</caption>
          <thead>
            <tr>
              <th scope="col">能力</th>
              <th scope="col">当前</th>
              <th scope="col">硬上限</th>
              <th scope="col">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.capability}>
                <th scope="row">
                  {row.label}
                  <span className="corn-editor__capability">
                    {row.capability}
                  </span>
                </th>
                <td>
                  <Level level={enforcedLevel(row)} />
                </td>
                <td>
                  <Level level={row.ceiling} />
                </td>
                <td className="corn-editor__note">
                  {exceedsCeiling(row.effective, row.ceiling)
                    ? `记录的级别高于硬上限，按上限执行。${row.note}`
                    : row.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="corn-editor__rules">
        <li>硬上限由策略决定，界面永远不能把任何一项调到上限之上。</li>
        <li>修改文件、运行命令、控制电脑等危险授权，每次都需要你人工确认。</li>
      </ul>
    </>
  )
}
