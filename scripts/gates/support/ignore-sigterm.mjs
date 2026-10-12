// Test double for gate A4 only: preloaded with `node --import` into the real
// DSH Host process so that SIGTERM neither terminates it nor reaches any
// handler the Host registers. Everything else in the process is unchanged.
process.on('SIGTERM', () => {})
for (const method of [
  'on',
  'addListener',
  'once',
  'prependListener',
  'prependOnceListener',
]) {
  const original = process[method].bind(process)
  process[method] = (event, listener) =>
    event === 'SIGTERM' ? process : original(event, listener)
}
