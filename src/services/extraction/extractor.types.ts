import { z } from 'zod';
import { requirementKindSchema, requirementPrioritySchema } from '../../domain/kit.schema.js';
import type { Role, Requirement } from '../../domain/kit.types.js';

export const rawExtractedRequirementSchema = z.object({
  text: z.string().trim().min(1, 'Requirement text cannot be empty'),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});

export const rawExtractedRoleSchema = z.object({
  title: z.string().trim().min(1, 'Role title cannot be empty'),
  seniority: z.string().trim().min(1, 'Seniority cannot be empty'),
  responsibilities: z.array(z.string().trim().min(1)).default([]),
  requirements: z.array(rawExtractedRequirementSchema).default([]),
});

export type RawExtractedRole = z.infer<typeof rawExtractedRoleSchema>;
export type RawExtractedRequirement = z.infer<typeof rawExtractedRequirementSchema>;

export interface ExtractionOptions {
  llmClient?: import('../llm/types.js').ILanguageModelClient;
  temperature?: number;
  maxRetries?: number;
}

export { Role, Requirement };
