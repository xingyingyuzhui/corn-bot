import type { BrowserWindow, IpcMain } from 'electron'
import {
  DATA_CHANNELS,
  type DataStatusView,
} from '../../../../packages/contracts/src/workspace.ts'
import { assertTrustedSender } from '../security/ipc-allowlist.ts'

/** Read-only data status: a closed status name, never a path, reason or count. */
export function registerDataIpc(
  ipc: Pick<IpcMain, 'handle'>,
  window: BrowserWindow,
  data: { view(): DataStatusView },
): void {
  ipc.handle(DATA_CHANNELS.status, (event) => {
    assertTrustedSender(event, window)
    return data.view()
  })
}
