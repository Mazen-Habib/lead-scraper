// Static filter option lists sourced directly from the scraper's shared
// taxonomy/region definitions (../../../shared/*.json) — the same files
// src/quality/classifier.js and src/quality/geography.js use to populate
// industry/region on every lead, so the filter UI's dropdown options can
// never drift out of sync with what the backend actually assigns.
import taxonomy from "../../../shared/taxonomy.json";
import regions from "../../../shared/regions.json";

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
