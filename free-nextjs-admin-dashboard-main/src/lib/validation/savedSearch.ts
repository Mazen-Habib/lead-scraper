import { z } from "zod";

// Mirrors the LeadsQuery shape in ../leads.ts. page/pageSize are excluded —
// a saved search stores the filter, not a specific page of results.
export const leadsFilterSchema = z.object({
  tier: z.string().optional(),
  source: z.string().optional(),
  industry: z.string().optional(),
  tag: z.string().optional(),
  region: z.string().optional(),
  firmSizeBand: z.string().optional(),
  minScore: z.number().optional(),
  maxScore: z.number().optional(),
  hasEmail: z.boolean().optional(),
  search: z.string().optional(),
  sortCol: z.enum(["score", "scraped_at"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const createSavedSearchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  filter_json: leadsFilterSchema,
});

export const updateSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
});
