import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow,
): void {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('Untrusted Corn IPC sender')
  }
}
