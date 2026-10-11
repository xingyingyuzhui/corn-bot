import { useWorkspace } from '../../app/workspace-context.tsx'
import type { ConnectorView } from '../../model/workspace.ts'
import { ActionButton } from '../../shared/ActionButton.tsx'
import { Dialog } from '../../shared/Dialog.tsx'
import '../../shared/controls.css'
import './connect-apps.css'
import { UNAVAILABLE } from '../../shared/unavailable.ts'

export interface ConnectAppsDialogProps {
  readonly onClose: () => void
}

function stateLabel(state: ConnectorView['state']): string {
  switch (state) {
    case 'connected':
      return '已连接'
    case 'disconnected':
      return '未连接'
    default: {
      const unreachable: never = state
      throw new Error(`Unknown connector state ${String(unreachable)}`)
    }
  }
}

/** Real connector state only: nothing here pretends to connect. */
export function ConnectAppsDialog({ onClose }: ConnectAppsDialogProps) {
  const { connectors } = useWorkspace()
  return (
    <Dialog
      title="连接应用"
      description="连接后 Bot 才能读取这些应用的数据。当前版本还不能连接任何应用。"
      onClose={onClose}
    >
      {connectors.length === 0 ? (
        <p className="corn-connectors__empty">暂无可连接的应用。</p>
      ) : (
        <ul className="corn-connectors">
          {connectors.map((connector) => (
            <li key={connector.id} className="corn-connector">
              <span className="corn-connector__text">
                <span className="corn-connector__name">{connector.name}</span>
                <span className="corn-connector__description">
                  {connector.description}
                </span>
                {connector.state === 'disconnected' ? (
                  <span className="corn-connector__reason">
                    {connector.unavailable ?? UNAVAILABLE.connectorAuth}
                  </span>
                ) : null}
              </span>
              <span
                className="corn-connector__state"
                data-state={connector.state}
              >
                {stateLabel(connector.state)}
              </span>
              {connector.state === 'disconnected' ? (
                <ActionButton
                  className="corn-button corn-connector__connect"
                  label={`连接 ${connector.name}`}
                  unavailable={
                    connector.unavailable ?? UNAVAILABLE.connectorAuth
                  }
                >
                  连接
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
