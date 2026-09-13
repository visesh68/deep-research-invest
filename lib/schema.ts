import { z } from "zod";

export const SourceSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  url: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const CitedBulletSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.number().int()).default([]),
});
export type CitedBullet = z.infer<typeof CitedBulletSchema>;

export const FinancialsSchema = z.object({
  revenue: z.string().optional(),
  revenueGrowthYoY: z.string().optional(),
  grossMargin: z.string().optional(),
  operatingMargin: z.string().optional(),
  peRatio: z.string().optional(),
  evEbitda: z.string().optional(),
  freeCashFlowMargin: z.string().optional(),
});
export type Financials = z.infer<typeof FinancialsSchema>;

export const ResearchAngleSchema = z.object({
  id: z.string(),
  query: z.string(),
});

export const ResearchPlanSchema = z.object({
  company: z.string(),
  ticker: z.string(),
  exchange: z.string().optional(),
  angles: z.array(ResearchAngleSchema).min(3).max(6),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export const ThesisSchema = z.object({
  company: z.string(),
  ticker: z.string(),
  exchange: z.string().optional(),
  rating: z.enum(["Buy", "Hold", "Sell"]),
  priceContext: z.string(),
  summary: z.string(),
  bullCase: z.array(CitedBulletSchema).min(3).max(5),
  bearCase: z.array(CitedBulletSchema).min(3).max(5),
  financials: FinancialsSchema,
  valuationSummary: z.string(),
  catalysts: z.array(CitedBulletSchema).min(2).max(4),
  risks: z.array(CitedBulletSchema).min(2).max(4),
  sources: z.array(SourceSchema),
});
export type Thesis = z.infer<typeof ThesisSchema>;
