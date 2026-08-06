// Static filter option lists sourced from local copies of the scraper's
// shared taxonomy/region definitions (kept in sync with /shared/*.json at
// the repo root — see src/quality/classifier.js and src/quality/geography.js,
// which populate industry/region on every lead using the same source data).
// These are copied rather than imported cross-directory because Vercel's
// configured Root Directory for this project is this app's own folder, and
// the build has no reliable access to files outside it.
import taxonomy from "./shared-data/taxonomy.json";
import regions from "./shared-data/regions.json";

export type IndustryOption = { slug: string; label: string };
export type RegionOption = { slug: string; label: string };

export const INDUSTRIES: IndustryOption[] = taxonomy.industries.map((i) => ({
  slug: i.slug,
  label: i.label,
}));

export const REGIONS: RegionOption[] = regions.regions.map((r) => ({
  slug: r.slug,
  label: r.label,
}));

export const FIRM_SIZE_BANDS: { band: string; label: string }[] = [
  { band: "solo", label: "Solo (1)" },
  { band: "small", label: "Small (2-10)" },
  { band: "mid", label: "Mid (11-249)" },
  { band: "large", label: "Large (250-999)" },
  { band: "enterprise", label: "Enterprise (1000+)" },
];
