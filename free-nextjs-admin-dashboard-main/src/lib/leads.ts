import type { Lead } from "./lead-types";
export type { Lead } from "./lead-types";
export { SOURCE_LABELS } from "./lead-types";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csv: string): Lead[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    if (!obj.score) obj.score = "";
    if (!obj.tier) obj.tier = "";
    return obj as Lead;
  });
}

export async function fetchLeads(): Promise<Lead[]> {
  // ── Local dev: read directly from filesystem (no GitHub fetch needed) ───────
  const localPath = process.env.LOCAL_CSV_PATH;
  if (localPath) {
    try {
      // Dynamic require so this module stays importable in client bundles
      // (the branch is never executed in the browser — env var is server-only)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      const csv = fs.readFileSync(localPath, "utf8");
      return parseCSV(csv);
    } catch (err) {
      console.error("LOCAL_CSV_PATH set but file not readable:", err);
      return [];
    }
  }

  // ── Production: fetch from GitHub raw ──────────────────────────────────────
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo) return [];

  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/output/leads-master.csv`;
  const headers: HeadersInit = { Accept: "text/plain" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(url, { headers, next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const csv = await res.text();
    return parseCSV(csv);
  } catch {
    return [];
  }
}
