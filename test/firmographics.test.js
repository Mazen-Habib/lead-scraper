import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEmployeeCount,
  firmSizeBand,
  parseHourlyRateFloor,
  normalizeFirmographics,
} from '../src/quality/firmographics.js';

test('parseEmployeeCount takes the midpoint of a range', () => {
  assert.equal(parseEmployeeCount('50 - 249'), 150);
});

test('parseEmployeeCount takes the single bound for an open-ended value', () => {
  assert.equal(parseEmployeeCount('1,000+'), 1000);
});

test('parseEmployeeCount returns null for empty or non-numeric input', () => {
  assert.equal(parseEmployeeCount(''), null);
  assert.equal(parseEmployeeCount(null), null);
  assert.equal(parseEmployeeCount('unknown'), null);
});

test('firmSizeBand maps employee counts to the right band', () => {
  assert.equal(firmSizeBand(1), 'solo');
  assert.equal(firmSizeBand(10), 'small');
  assert.equal(firmSizeBand(150), 'mid');
  assert.equal(firmSizeBand(500), 'large');
  assert.equal(firmSizeBand(5000), 'enterprise');
  assert.equal(firmSizeBand(null), null);
});

test('parseHourlyRateFloor extracts the numeric floor', () => {
  assert.equal(parseHourlyRateFloor('$25 - $49 / hr'), 25);
  assert.equal(parseHourlyRateFloor('$150+'), 150);
  assert.equal(parseHourlyRateFloor(''), null);
});

test('normalizeFirmographics fills employee_count/firm_size_band/is_enterprise in place', () => {
  const leads = [{ company_size: '1,000+' }, { company_size: '' }];
  normalizeFirmographics(leads);
  assert.equal(leads[0].employee_count, 1000);
  assert.equal(leads[0].firm_size_band, 'enterprise');
  assert.equal(leads[0].is_enterprise, true);
  assert.equal(leads[1].employee_count, null);
  assert.equal(leads[1].is_enterprise, false);
});
