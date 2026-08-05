// Normalizes the free-text firmographic fields scrapers provide (roadmap 3.4)
// into real numbers so "50 - 249" and "1,000+" become comparable data instead
// of indistinguishable strings.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TAXONOMY = JSON.parse(readFileSync(resolve(root, 'shared/taxonomy.json'), 'utf8'));

/**
 * Parses a free-text company_size string ("50 - 249", "1,000+", "10+") into
 * an approximate employee_count. Uses the range's midpoint, or the bound
 * itself for open-ended "N+" values. Returns null if nothing numeric is found.
 */
export function parseEmployeeCount(companySize) {
  if (!companySize) return null;
  const nums = String(companySize)
    .replace(/,/g, '')
    .match(/\d+/g);
  if (!nums || nums.length === 0) return null;

  if (nums.length === 1) return parseInt(nums[0], 10);

  const [lo, hi] = nums.map(Number);
  return Math.round((lo + hi) / 2);
}

/** Maps an employee_count to a firm_size_band per shared/taxonomy.json's bands. */
export function firmSizeBand(employeeCount) {
  if (employeeCount == null) return null;
  for (const { band, maxEmployees } of TAXONOMY.firmSizeBands) {
    if (maxEmployees == null || employeeCount <= maxEmployees) return band;
  }
  return null;
}

/**
 * Parses a free-text hourly_rate string ("$25 - $49 / hr", "$150+") into a
 * numeric floor, used as the "big tech firm" price signal.
 */
export function parseHourlyRateFloor(hourlyRate) {
  if (!hourlyRate) return null;
  const nums = String(hourlyRate).match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  return parseInt(nums[0], 10);
}

/** Fills employee_count/firm_size_band/is_enterprise on every lead, in place. */
export function normalizeFirmographics(leads) {
  for (const lead of leads) {
    const employeeCount = parseEmployeeCount(lead.company_size);
    lead.employee_count = employeeCount;
    lead.firm_size_band = firmSizeBand(employeeCount);
    lead.is_enterprise = employeeCount != null && employeeCount >= TAXONOMY.enterpriseEmployeeThreshold;
  }
  return leads;
}
