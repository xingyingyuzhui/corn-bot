import type { PermissionRow } from '../../../model/workspace.ts'
import { ActionButton } from '../../../shared/ActionButton.tsx'
import { UNAVAILABLE } from '../../../shared/unavailable.ts'
import { PermissionMatrix } from '../../bot-editor/PermissionMatrix.tsx'
import { SectionStatus } from '../SectionStatus.tsx'

interface PermissionsSectionProps {
  readonly rows: readonly PermissionRow[] | undefined
}

/** Read-only in M1; changes open with Claw Policy in M2, local control in M3. */
export function PermissionsSection({ rows }: PermissionsSectionProps) {
  return (
    <>
      <section className="corn-details__group" aria-label="权限矩阵">
        <p className="corn-details__note">
          只读查看。M1 不能修改权限：权限变更在 M2 接入 Claw Policy 后开放。
        </p>
        {rows === undefined ? (
          <SectionStatus
            state={{
              kind: 'unavailable',
              reason: UNAVAILABLE.permissionRecords,
            }}
          />
        ) : (
          <PermissionMatrix rows={rows} />
        )}
        <ActionButton
          className="corn-button corn-editor__soft-button"
          label="修改权限"
          unavailable={UNAVAILABLE.permissionEdit}
        >
          修改权限
        </ActionButton>
      </section>
      <section
        className="corn-details__group"
        aria-labelledby="permissions-local"
      >
        <h4 id="permissions-local" className="corn-details__group-title">
          本机操作
        </h4>
        <SectionStatus
          state={{ kind: 'unavailable', reason: UNAVAILABLE.computerControl }}
        />
        <p className="corn-details__note">
          Claw 策略授权与 macOS 系统授权分开显示；界面上的开关不代表系统已授权。
        </p>
      </section>
    </>
  )
}
