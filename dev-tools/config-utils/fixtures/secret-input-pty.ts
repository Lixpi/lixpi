import assert from 'node:assert/strict'
import {
    isCancel,
    text,
} from '@clack/prompts'
import { SecretInputPrompt } from '../secret-input.ts'

assert.equal(process.stdin.isTTY, true)
const first = await text({ message: 'FIRST INPUT' })
assert.equal(first, 'start')
const wasRaw = process.stdin.isRaw ?? false
const token = await new SecretInputPrompt({
    message: 'PTY synthetic secret',
    validate: value => value.length ? undefined : 'Enter a token',
}).prompt()

if (process.env.SECRET_INPUT_EXPECT_CANCEL === 'true')
    assert.equal(
        isCancel(token),
        true,
    )
else
    assert.equal(token === 'x'.repeat(1048576), true)

assert.equal(process.stdin.isRaw, wasRaw)
const next = await text({ message: 'SECOND INPUT' })
assert.equal(next, 'next')
process.stdout.write('PTY CHECK PASSED\n')
