// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipients } from '../../api/_lib/messages.js';

test('a message goes to all admins, or to one chosen admin', () => {
  assert.deepEqual(resolveRecipients('all', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(resolveRecipients('b', ['a', 'b']), ['b']);
});

test('a message cannot go to someone who is not an admin', () => {
  assert.throws(() => resolveRecipients('worker-1', ['a', 'b']), /active admin/);
  assert.throws(() => resolveRecipients('all', []), /no admins/);
});
