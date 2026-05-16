import test from 'node:test';
import assert from 'node:assert/strict';

test('customer balance sign: debit positive, credit negative', () => {
  const debit = 15000;
  const credit = 10000;
  assert.equal(debit - credit, 5000);
});

test('performance penalty example: 94% efficiency => 12% salary deduction proposal', () => {
  const efficiency = 94;
  const loss = 100 - efficiency;
  assert.equal(loss * 2, 12);
});
