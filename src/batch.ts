#!/usr/bin/env node

/**
 * Mandatory Batch Evaluation Command (Phase 13)
 *
 * Exposes:
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Input format (cases.json):
 *   [
 *     { "id": "case-01", "jd": "...", "company_url": "...", "days": 5 },
 *     ...
 *   ]
 *
 * Output format (kits.json):
 *   {
 *     "version": "1.0",
 *     "generated_at": "2026-09-04T10:00:00.000Z",
 *     "kits": [
 *       {
 *         "id": "case-01",
 *         "status": "ok",
 *         "kit": { ... },
 *         "error": null
 *       },
 *       {
 *         "id": "case-04",
 *         "status": "failed",
 *         "kit": null,
 *         "error": {
 *           "code": "INVALID_INPUT",
 *           "message": "..."
 *         }
 *       }
 *     ]
 *   }
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded whether run from backend or root directory
dotenv.config();
if (!process.env.LLM_API_KEY) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}
if (!process.env.LLM_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
}

import { generateInterviewKit } from './services/orchestrator/index.js';
import { validateKit } from './domain/kit.validator.js';
import type { GenerateKitOptions } from './services/orchestrator/orchestrator.types.js';

export interface CaseInput {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface CaseOutputOk {
  id: string;
  status: 'ok';
  kit: Record<string, unknown>;
  error: null;
}

export interface CaseOutputFailed {
  id: string;
  status: 'failed';
  kit: null;
  error: {
    code: string;
    message: string;
  };
}

export type CaseOutput = CaseOutputOk | CaseOutputFailed;

export interface BatchEvaluationOutput {
  version: '1.0';
  generated_at: string;
  kits: CaseOutput[];
}

/**
 * Parses CLI arguments supporting both `--flag value` and `--flag=value` formats.
 */
export function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '';
  let output = '';

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) {
      input = argv[++i];
    } else if (arg.startsWith('--input=')) {
      input = arg.slice('--input='.length);
    } else if (arg === '--output' && i + 1 < argv.length) {
      output = argv[++i];
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    }
  }

  if (!input) {
    console.error('Error: --input <cases.json> is required');
    process.exit(1);
  }
  if (!output) {
    console.error('Error: --output <kits.json> is required');
    process.exit(1);
  }

  let resolvedInput = path.resolve(process.cwd(), input);
  let resolvedOutput = path.resolve(process.cwd(), output);

  // If input doesn't exist in process.cwd(), check if it exists in parent directory
  // (handles execution via root package.json npm scripts)
  if (!fs.existsSync(resolvedInput)) {
    const parentInput = path.resolve(process.cwd(), '..', input);
    if (fs.existsSync(parentInput)) {
      resolvedInput = parentInput;
      if (!path.isAbsolute(output)) {
        resolvedOutput = path.resolve(process.cwd(), '..', output);
      }
    }
  }

  return {
    input: resolvedInput,
    output: resolvedOutput,
  };
}

/**
 * Validates the input file and parses the JSON array.
 */
export function loadCases(inputPath: string): unknown[] {
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(inputPath, 'utf-8');
  } catch (err: unknown) {
    console.error(`Error reading input file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    console.error(`Error: Input file contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error('Error: Input file must contain a JSON array of cases');
    process.exit(1);
  }

  return parsed;
}

/**
 * Processes an individual case through the full generation pipeline.
 * Records failure instead of aborting the overall batch.
 */
export async function evaluateCase(
  rawCase: unknown,
  index: number,
  options?: GenerateKitOptions
): Promise<CaseOutput> {
  const c = rawCase as Partial<CaseInput> | null;
  const caseId =
    c && typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `case-${index + 1}`;

  // Case format validation
  if (!c || typeof c !== 'object') {
    return {
      id: caseId,
      status: 'failed',
      kit: null,
      error: {
        code: 'INVALID_INPUT',
        message: 'Case must be a non-null JSON object',
      },
    };
  }

  if (!c.jd || typeof c.jd !== 'string' || !c.jd.trim()) {
    return {
      id: caseId,
      status: 'failed',
      kit: null,
      error: {
        code: 'INVALID_INPUT',
        message: 'Job description (jd) must be a non-empty string',
      },
    };
  }

  if (!c.company_url || typeof c.company_url !== 'string' || !c.company_url.trim()) {
    return {
      id: caseId,
      status: 'failed',
      kit: null,
      error: {
        code: 'INVALID_INPUT',
        message: 'Company website URL (company_url) must be a non-empty string',
      },
    };
  }

  const daysNum = Number(c.days);
  if (!Number.isInteger(daysNum) || daysNum < 1) {
    return {
      id: caseId,
      status: 'failed',
      kit: null,
      error: {
        code: 'INVALID_INPUT',
        message: 'Days before interview (days) must be an integer >= 1',
      },
    };
  }

  // Run the full deliberate generation pipeline with per-case timeout
  try {
    const CASE_TIMEOUT_MS = 300_000; // 5 minutes per case to accommodate full multi-stage LLM generation
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Case timed out after ${CASE_TIMEOUT_MS / 1000}s`)), CASE_TIMEOUT_MS);
    });

    let result;
    try {
      result = await Promise.race([
        generateInterviewKit(
          {
            jd: c.jd.trim(),
            company_url: c.company_url.trim(),
            days: daysNum,
            persist: false,
            onProgress: (evt) => {
              console.log(`[evaluate] [${caseId}] Step ${evt.step}/${evt.totalSteps}: ${evt.message}`);
            },
          },
          {
            ...options,
            crawlerOptions: {
              allowLocal: true,
              ...options?.crawlerOptions,
            },
          }
        ),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    // Validate generated kit against Appendix A contract
    const validation = validateKit(result.kit);
    if (!validation.valid) {
      return {
        id: caseId,
        status: 'failed',
        kit: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Kit failed Appendix A contract: ${validation.errors.join('; ')}`,
        },
      };
    }

    return {
      id: caseId,
      status: 'ok',
      kit: result.kit as unknown as Record<string, unknown>,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as any)?.code || (err as any)?.name || 'GENERATION_ERROR';
    return {
      id: caseId,
      status: 'failed',
      kit: null,
      error: {
        code: String(code),
        message,
      },
    };
  }
}

/**
 * Main batch runner CLI execution.
 */
export async function runBatchEvaluation(
  inputPath: string,
  outputPath: string,
  options?: GenerateKitOptions
): Promise<BatchEvaluationOutput> {
  const rawCases = loadCases(inputPath);
  console.log(`[evaluate] Processing ${rawCases.length} case(s) from ${inputPath}`);

  const caseOutputs: CaseOutput[] = [];

  for (let i = 0; i < rawCases.length; i++) {
    const raw = rawCases[i];
    const caseId = (raw as any)?.id || `case-${i + 1}`;
    console.log(`[evaluate] (${i + 1}/${rawCases.length}) Evaluating case: ${caseId}...`);

    const output = await evaluateCase(raw, i, options);
    caseOutputs.push(output);

    if (output.status === 'ok') {
      console.log(`[evaluate] ✓ ${caseId} status: ok`);
    } else {
      console.warn(`[evaluate] ✗ ${caseId} status: failed (${output.error?.code}: ${output.error?.message})`);
    }
  }

  const batchOutput: BatchEvaluationOutput = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits: caseOutputs,
  };

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(batchOutput, null, 2), 'utf-8');
  console.log(`[evaluate] Complete. Written to: ${outputPath}`);

  const okCount = caseOutputs.filter((k) => k.status === 'ok').length;
  const failedCount = caseOutputs.filter((k) => k.status === 'failed').length;
  console.log(`[evaluate] Summary: ${okCount} ok, ${failedCount} failed out of ${caseOutputs.length} total.`);

  return batchOutput;
}

// Only invoke CLI runner when executed directly
if (process.argv[1] && (process.argv[1].endsWith('batch.ts') || process.argv[1].endsWith('batch.js'))) {
  const { input, output } = parseArgs(process.argv);
  runBatchEvaluation(input, output).catch((err) => {
    console.error('[evaluate] Fatal unexpected error:', err);
    process.exit(1);
  });
}
