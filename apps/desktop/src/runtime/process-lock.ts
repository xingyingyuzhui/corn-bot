import { randomUUID } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** An exclusive Corn home owner. Stale locks require explicit recovery, never blind deletion. */
export async function acquireProcessLock(
  home: string,
): Promise<() => Promise<void>> {
  const path = join(home, 'corn-host.lock')
  const identity = JSON.stringify({ pid: process.pid, nonce: randomUUID() })
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'wx', 0o600)
  } catch {
    throw new Error(
      'Corn runtime home is locked; close its owner or inspect a stale lock before recovery',
    )
  }
  try {
    await handle.writeFile(identity)
  } finally {
    await handle.close()
  }
  let releaseFlight: Promise<void> | undefined
  return () => {
    releaseFlight ??= (async () => {
      if ((await readFile(path, 'utf8')) !== identity)
        throw new Error('Corn process lock owner changed')
      await unlink(path)
    })()
    return releaseFlight
  }
}
