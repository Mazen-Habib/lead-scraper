// CSV serialization, shared by src/index.js's run/master file writers and
// src/lib/pushToSupabase.js's sync-failure recovery file — extracted so the
// latter can write a CSV without importing back from src/index.js (which
// itself imports pushToSupabase.js, i.e. a circular import).
import { CSV_COLUMNS } from './leadFields.js';

export function csvCell(value) {
  const s = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records) {
  const header = CSV_COLUMNS.map(([, title]) => title).join(',');
  const rows = records.map((rec) =>
    CSV_COLUMNS.map(([id]) => csvCell(rec[id])).join(',')
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}
