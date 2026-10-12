/** Main-owned services in the order the App starts and stops them. */
export interface DataLifecycle {
  /** Resolves to a closed status; never rejects. */
  open(): Promise<unknown>
  verifyHome(): Promise<unknown>
  close(): Promise<void>
}

export interface RuntimeLifecycle {
  start(): Promise<void>
  shutdown(): Promise<void>
}

/**
 * The database opens before the Host starts and independently of it: a data
 * failure leaves chat disabled but never blocks the runtime. The home pairing
 * is checked once the Host has claimed its home. `cancelled` reports a quit
 * that began meanwhile.
 */
export async function startServices(
  data: DataLifecycle,
  runtime: RuntimeLifecycle,
  cancelled: () => boolean,
): Promise<void> {
  await data.open()
  if (cancelled()) return
  await runtime.start()
  if (cancelled()) return
  await data.verifyHome()
}

/**
 * Quit: the Host stops first so nothing writes on its behalf, then the
 * database checkpoints and closes even if the Host stop failed. The first
 * failure is rethrown after both ran.
 */
export async function stopServices(
  runtime: RuntimeLifecycle,
  data: DataLifecycle,
): Promise<void> {
  const failures: unknown[] = []
  try {
    await runtime.shutdown()
  } catch (error) {
    failures.push(error)
  }
  try {
    await data.close()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) throw failures[0]
}
