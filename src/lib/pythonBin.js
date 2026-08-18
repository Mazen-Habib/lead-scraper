// Resolves a working Python 3 executable. On Windows `python3` is usually just
// the Microsoft Store stub (not real Python), so we probe candidates and pick
// the first that actually reports Python 3. Override with PYTHON_BIN in .env.
//
// Extracted from src/index.js so scripts/ingest-run-csv.js can pass a real
// pythonBin to runPipeline() too — it used to call runPipeline(raw, { config })
// with no pythonBin at all, which meant the ScrapegraphAI email-enrichment rung
// (Groq/Mistral/OpenRouter — the biggest single lever for lifting directory
// leads over the score floor) silently never ran for anything ingested through
// that path. Every prior businesslist.pk ingest only got emailFinder.js's
// plain-fetch enrichment, never the LLM rung.
import { spawnSync } from 'child_process';

export function resolvePythonBin() {
  const candidates = process.env.PYTHON_BIN
    ? [process.env.PYTHON_BIN]
    : process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
      if (r.status === 0 && /Python 3/.test((r.stdout || '') + (r.stderr || ''))) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}
