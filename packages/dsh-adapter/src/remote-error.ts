export class RemoteError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RemoteError(
      'corn/invalid-response',
      'Host returned a non-object response',
    )
  }
  return value as Record<string, unknown>
}
