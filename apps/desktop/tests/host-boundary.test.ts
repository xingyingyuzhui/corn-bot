import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { HostAuth } from '../src/runtime/host-auth.ts'
import {
  parseReadinessLine,
  parseSkippedBundleLine,
  redactHostDiagnostic,
  validateLaunchUrl,
} from '../src/runtime/host-readiness.ts'

test('readiness only trusts the exact child loopback root authentication URL', () => {
  const good = 'http://127.0.0.1:34567/?token=example'
  assert.equal(parseReadinessLine(`dsh web: ${good}`)?.href, good)
  assert.equal(parseReadinessLine('arbitrary output'), undefined)
  for (const invalid of [
    'https://remote.invalid/?token=example',
    'http://127.0.0.1:34567/api/?token=example',
    'http://user@127.0.0.1:34567/?token=example',
    'http://127.0.0.1:34567/',
  ]) {
    assert.throws(() => validateLaunchUrl(invalid))
  }
})

test('skipped profile bundle lines name exactly the bundle DSH did not load', () => {
  assert.equal(
    parseSkippedBundleLine(
      'dsh: skipping profile bundle "dsh-claw-suite": Error: cannot resolve',
    ),
    'dsh-claw-suite',
  )
  assert.equal(
    parseSkippedBundleLine('dsh: skipping profile bundle "a\\"b": x'),
    'a"b',
  )
  assert.equal(parseSkippedBundleLine('dsh-claw-suite loaded'), undefined)
  assert.equal(
    parseSkippedBundleLine('x dsh: skipping profile bundle "dsh-claw-suite":'),
    undefined,
  )
})

test('diagnostics redact launch tokens, cookies and common API key forms', () => {
  const value = redactHostDiagnostic(
    'http://127.0.0.1:1234/?token=private-token dsh-auth-x=private-cookie; sk-privatekey',
  )
  assert.ok(!value.includes('private-token'))
  assert.ok(!value.includes('private-cookie'))
  assert.ok(!value.includes('sk-privatekey'))
})

test('token exchange requires RC2 directory-relative redirect and authority-bound cookie', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(303, {
      location: './',
      'set-cookie': 'dsh-auth-test=secret; HttpOnly; SameSite=Strict',
    })
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const auth = await HostAuth.exchange(
      new URL(`http://127.0.0.1:${address.port}/?token=test`),
    )
    assert.ok(!JSON.stringify(auth).includes('secret'))
    assert.throws(() => auth.url('//remote.invalid/api/session/list'))
    assert.throws(() => auth.url('/api/../outside'))
    assert.throws(() => auth.url('/api/session/list?token=exfiltrate')) // Explicit secrets never enter API paths.
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
