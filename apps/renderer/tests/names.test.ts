import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nameLengthError } from '../src/features/bot-editor/create-bot-form.ts'
import { initialOf, nameLength, sameName } from '../src/model/names.ts'

test('names count user-perceived characters, not code units', () => {
  assert.equal(initialOf(' 👨‍👩‍👧 家庭助手'), '👨‍👩‍👧')
  assert.equal(initialOf('🇨🇳 中文'), '🇨🇳')
  assert.equal(nameLength('🇨🇳中'), 2)
  assert.equal(initialOf('   '), '')
  assert.ok(sameName(' Excel专员 ', 'excel专员'))
})

test('an over-long name is flagged while typing', () => {
  assert.equal(nameLengthError('🚀'.repeat(24), 24), null)
  assert.equal(nameLengthError('🚀'.repeat(25), 24), '名称最多 24 个字')
})
