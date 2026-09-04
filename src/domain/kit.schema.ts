import { z } from 'zod';

export const requirementKindSchema = z.enum(['technical', 'behavioural', 'domain']);
export const requirementPrioritySchema = z.enum(['must', 'nice']);

export const requirementSchema = z.object({
  id: z.string().trim().min(1, 'Requirement id must be a non-empty string'),
  text: z.string().trim().min(1, 'Requirement text must be a non-empty string'),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});

export const questionCategorySchema = z.enum([
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
]);

export const questionDifficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const itemStatusSchema = z.enum(['generated', 'edited', 'manual']);

export const questionSchema = z.object({
  id: z.string().trim().min(1, 'Question id must be a non-empty string'),
  requirement_ids: z.array(z.string().trim().min(1, 'requirement_ids entries must be non-empty strings')),
  category: questionCategorySchema,
  prompt: z.string().trim().min(1, 'Question prompt must be a non-empty string'),
  answer_outline: z.union([
    z.string().trim().min(1, 'answer_outline cannot be empty'),
    z.array(z.string().trim().min(1)).min(1, 'answer_outline array cannot be empty'),
  ]),
  difficulty: questionDifficultySchema,
  item_status: itemStatusSchema.optional(),
  isPinned: z.boolean().optional(),
  isEdited: z.boolean().optional(),
  isCustom: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).passthrough();

export const flashcardSchema = z.object({
  id: z.string().trim().min(1, 'Flashcard id must be a non-empty string'),
  front: z.string().trim().min(1, 'Flashcard front must be a non-empty string'),
  back: z.string().trim().min(1, 'Flashcard back must be a non-empty string'),
  requirement_ids: z.array(z.string().trim().min(1, 'requirement_ids entries must be non-empty strings')),
  item_status: itemStatusSchema.optional(),
  isPinned: z.boolean().optional(),
  isEdited: z.boolean().optional(),
  isCustom: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).passthrough();

export const scheduleDaySchema = z.object({
  day: z.number().int('Schedule day must be an integer').min(1, 'Schedule day must be at least 1'),
  focus: z.string().trim().min(1, 'Schedule day focus must be a non-empty string'),
  question_ids: z.array(z.string().trim().min(1, 'question_ids entries must be non-empty strings')),
  minutes: z.number().int('Schedule day minutes must be an integer').min(1, 'Schedule day minutes must be positive'),
});

export const scheduleSchema = z.object({
  days_available: z.number().int('days_available must be an integer').min(1, 'days_available must be at least 1'),
  days: z.array(scheduleDaySchema).min(1, 'Schedule must contain at least one day'),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string().trim().min(1)),
  passes: z.number().int('passes must be an integer').min(1, 'passes must be at least 1'),
});

export const sourceSchema = z.object({
  company: z.string().trim().min(1, 'Source company must be a non-empty string'),
  company_url: z.string().trim().min(1, 'Source company_url must be a non-empty string'),
  role: z.string().trim().min(1, 'Source role must be a non-empty string'),
  location: z.string().trim().min(1, 'Source location must be a non-empty string'),
  jd_chars: z.number().int('jd_chars must be an integer').min(0, 'jd_chars cannot be negative'),
  researched_at: z.string().trim().min(1, 'researched_at must be a non-empty string'),
  pages_used: z.array(z.string().trim().min(1)),
});

export const companyBriefSchema = z.object({
  summary: z.string().trim().min(1, 'company_brief summary must be a non-empty string'),
  what_they_do: z.string().trim().min(1, 'company_brief what_they_do must be a non-empty string'),
  sources: z.array(z.string().trim().min(1)),
  item_status: itemStatusSchema.optional(),
  isEdited: z.boolean().optional(),
  version: z.number().int().min(1).optional(),
}).passthrough();

export const roleSchema = z.object({
  title: z.string().trim().min(1, 'Role title must be a non-empty string'),
  seniority: z.string().trim().min(1, 'Role seniority must be a non-empty string'),
  responsibilities: z.array(z.string().trim().min(1)).min(1, 'At least one responsibility is required'),
  requirements: z.array(requirementSchema).min(1, 'At least one requirement is required'),
});

export const kitBaseSchema = z.object({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema).min(1, 'At least one question is required'),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
  id: z.string().optional(),
  user_id: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
