const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const {
  transitions,
  validateCreateFindingBody,
  validateDueDate,
  validateOptionBody,
} = require('../src/qa-findings');

test('finding workflow transitions are explicit and role-bound', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(transitions).map(([key, value]) => [key, `${value.role}:${value.from}->${value.to}`])),
    {
      respond: 'provider:OPEN->RESPONSE_SUBMITTED',
      verify: 'qa:RESPONSE_SUBMITTED->VERIFIED',
      return: 'qa:RESPONSE_SUBMITTED->OPEN',
      close: 'qa:VERIFIED->CLOSED',
    },
  );
});

test('due dates must be real, correctly formatted, and not in the past', () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.equal(validateDueDate(tomorrow).value, tomorrow);
  assert.equal(validateDueDate(undefined).value, null);
  assert.equal(validateDueDate('').value, null);
  assert.ok(validateDueDate('2026-02-30').error);
  assert.ok(validateDueDate('13/11/2026').error);
  assert.ok(validateDueDate('2000-01-01').error);
});

test('finding bodies require text fields and reject unknown keys', () => {
  const base = { qaReviewId: randomUUID(), finding: ' Missing signature ', correctiveAction: 'Re-sign' };
  assert.deepEqual(validateCreateFindingBody(base).value, {
    qaReviewId: base.qaReviewId,
    finding: 'Missing signature',
    correctiveAction: 'Re-sign',
    categoryId: null,
    severityId: null,
    dueDate: null,
  });
  assert.ok(validateCreateFindingBody({ ...base, finding: '   ' }).error);
  assert.ok(validateCreateFindingBody({ ...base, correctiveAction: 'x'.repeat(4001) }).error);
  assert.ok(validateCreateFindingBody({ ...base, qaReviewId: 'not-a-uuid' }).error);
  assert.ok(validateCreateFindingBody({ ...base, categoryId: 'bad' }).error);
  assert.ok(validateCreateFindingBody({ ...base, status: 'CLOSED' }).error);
});

test('finding option bodies accept only configured kinds and bounded labels', () => {
  assert.deepEqual(validateOptionBody({ kind: 'SEVERITY', label: ' High ' }).value, { kind: 'SEVERITY', label: 'High' });
  assert.ok(validateOptionBody({ kind: 'PRIORITY', label: 'High' }).error);
  assert.ok(validateOptionBody({ kind: 'CATEGORY', label: 'x'.repeat(81) }).error);
  assert.deepEqual(validateOptionBody({ isActive: false }, { partial: true }).value, { isActive: false });
  assert.ok(validateOptionBody({ kind: 'CATEGORY' }, { partial: true }).error);
  assert.ok(validateOptionBody({}, { partial: true }).error);
});
