# AI Interview Prep Kit — Backend API & Evaluation Engine

Express TypeScript backend and evaluation engine that powers the AI Interview Prep Kit — featuring an automated multi-step research pipeline, deterministic coverage guarantees, an arithmetic study schedule, and the mandatory batch evaluation CLI.

---

## Table of Contents
1. [Overview & Tech Stack](#overview--tech-stack)
2. [Architecture](#architecture)
3. [Setup & Installation](#setup--installation)
4. [Environment Variables](#environment-variables)
5. [Batch Evaluation Command (Mandatory)](#batch-evaluation-command-mandatory)
6. [LLM Provider & Model Configuration](#llm-provider--model-configuration)
7. [Research & Generation Sequencing](#research--generation-sequencing)
8. [Deterministic Coverage & The Second Pass](#deterministic-coverage--the-second-pass)
9. [Scheduler Mathematics](#scheduler-mathematics)
10. [State Model (Preserving User Work)](#state-model-preserving-user-work)
11. [Security & Resilience](#security--resilience)
12. [API Reference](#api-reference)
13. [Testing](#testing)

---

## Overview & Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express + TypeScript
- **Database**: MongoDB (via Mongoose)
- **Validation**: Zod (strict schema enforcement matching Appendix A)
- **Testing**: Node.js test runner (`tsx --test`)
- **Execution Tooling**: `tsx` (TypeScript execution and watcher)

---

## Architecture

```
backend/
├── src/
│   ├── index.ts                     # Express server & route registration
│   ├── batch.ts                     # Mandatory Batch Evaluation CLI (Section 9)
│   ├── domain/
│   │   ├── kit.types.ts             # Appendix A TypeScript interfaces
│   │   ├── kit.schema.ts            # Zod validation schemas
│   │   └── kit.validator.ts         # Validation assertions & error formatters
│   ├── models/
│   │   ├── user.model.ts            # User auth schema
│   │   ├── kit.model.ts             # Kit schema with ownership isolation
│   │   └── practice.model.ts        # Card confidence ratings & session tracking
│   ├── routes/
│   │   ├── auth.routes.ts           # /api/auth (register, login, me)
│   │   ├── kit.routes.ts            # /api/kits (CRUD, generate, regenerate)
│   │   ├── practice.routes.ts       # /api/practice (progress, weak spots)
│   │   └── health.routes.ts         # /api/health
│   ├── middleware/
│   │   ├── auth.ts                  # JWT verification & ownership guard
│   │   ├── error.handler.ts         # Centralized structured error handling
│   │   └── rate.limiter.ts          # Request rate limiting
│   └── services/
│       ├── crawler/                 # Dynamic site crawl, link ranker, SSRF guard
│       ├── extraction/              # JD requirement extractor & anti-hallucination
│       ├── research/                # Public interview discussions research
│       ├── generation/              # Category-specific LLM question prompts
│       ├── coverage/                # Deterministic gap detection & second pass
│       ├── flashcards/              # Flashcard generator with fallback
│       ├── schedule/                # Arithmetic schedule allocator
│       ├── regeneration/            # Isolated section & category regeneration
│       ├── orchestrator/            # Multi-step pipeline coordination
│       └── llm/                     # Universal LLM client with backoff & sanitization
```

---

## Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Set your configuration values:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/trao-interview-prep
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
CORS_ORIGIN=http://localhost:3000

# LLM Configuration (NVIDIA NIM, Groq, or OpenAI)
LLM_PROVIDER=nvidia
LLM_API_KEY=your_llm_api_key
LLM_MODEL=meta/llama-3.2-11b-vision-instruct
```

### 3. Run Development Server
```bash
npm run dev
# Server ready at http://localhost:5000
```

### 4. Build for Production
```bash
npm run build
npm start
```

---

## Batch Evaluation Command (Mandatory)

The assessment specifies an exact automated batch evaluation entry point:

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

### Input Shape (`cases.json` - Appendix B):
```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\n\nWe are looking for...",
    "company_url": "https://company.com",
    "days": 5
  }
]
```

### Output Shape (`kits.json` - Appendix B):
```json
{
  "version": "1.0",
  "generated_at": "2026-09-04T12:00:00.000Z",
  "kits": [
    {
      "id": "case-01",
      "status": "ok",
      "kit": { ... Appendix A Structure ... },
      "error": null
    },
    {
      "id": "case-04",
      "status": "failed",
      "kit": null,
      "error": {
        "code": "COMPANY_UNREACHABLE",
        "message": "Company site unreachable after 3 retries."
      }
    }
  ]
}
```

### Execution Properties:
- Uses the **exact production generation pipeline** (`generateInterviewKit`), not a mocked or parallel implementation.
- Continues past individual failures, recording the failure reason in `kits[i].error`.
- Conforms strictly to the Appendix A data structure and types.
- Supports local company URLs (`http://localhost:...`) for automated evaluation test harness runs.

---

## LLM Provider & Model Configuration

- **Provider**: NVIDIA NIM / OpenAI-compatible endpoint. Groq and OpenRouter are also supported via `UniversalLLMClient`.
- **Model**: `meta/llama-3.2-11b-vision-instruct` (or `meta-llama/llama-3.1-8b-instruct`).
- **Resilience**:
  - Exponential backoff with jitter on HTTP 429 rate limits and 5xx errors.
  - Custom AST-level JSON sanitizer that cleans unescaped control characters (`\n`, `\r`, `\t`), validates unicode escapes, and repairs truncated JSON brackets prior to Zod validation.

---

## Research & Generation Sequencing

The pipeline executes through a sequence of deliberate steps:

1. **Extraction**: Analyzes JD text, extracts requirements classified by kind (`technical`, `behavioural`, `domain`) and priority (`must` vs `nice`). Anti-hallucination lexical filter validates each requirement against the text.
2. **Company Crawl**: Fetches the company URL, parses HTML, and extracts company overview.
3. **Dynamic Hiring Discovery**: Ranks internal links by keyword score (e.g. `/careers`, `/jobs`, `/handbook`, `/engineering-blog`) to find hiring process details.
4. **Interview Research**: Searches public interview discussions for interview rounds, technical screens, and question styles.
5. **Category-Specific Question Generation (Pass 1)**: Questions are generated per category with injected research context. Technical requirements produce implementation questions; behavioural produce STAR prompts.
6. **Deterministic Coverage Check (Pass 2)**: Code compares question `requirement_ids` against requirements. Any uncovered `must` requirement triggers Pass 2 to generate missing questions.
7. **Flashcards Generation**: Produces flashcards linked to requirement IDs with deterministic fallback.
8. **Arithmetic Schedule Allocation**: Code distributes questions across the requested days with integer minutes.
9. **Validation & Storage**: Validates against Appendix A schema before writing to MongoDB.

---

## State Model (Preserving User Work)

When regenerating an individual section or category:

| Flag / Property | Meaning | Preservation Guarantee |
| :--- | :--- | :--- |
| `item_status: "edited"` / `isEdited: true` | User modified text or metadata | **Never overwritten** |
| `item_status: "manual"` / `isCustom: true` | User added question/card by hand | **Never deleted** |
| `isPinned: true` | User explicitly pinned item | **Immune to category regeneration** |
| `version: number` | Monotonically incrementing counter | Audit trail of mutations |

During category regeneration (e.g., `technical`):
- Other categories remain untouched.
- In the target category, all edited, manual, and pinned questions are kept in place.
- Only unedited generated questions are replaced.

---

## Scheduler Mathematics

- **Deterministic Code**: No LLM prompt is used for scheduling.
- **Priority Scoring**: Must-have requirements receive priority boost (+1000). Difficulty 3 questions receive higher scores.
- **Front-Loaded Distribution**: Harder and higher-priority material is placed on earlier days (Day 1, 2, ...) rather than the night before the interview.
- **Integer Minutes**: Daily study durations are whole numbers (`minutes: 60`).
- **Exact Days**: Generates exactly `days_available` day entries (supports 1 to 60 days).

---

## Security & Resilience

- **SSRF Prevention**: Validates external URLs against private IPv4 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`), private IPv6, link-local, and cloud metadata addresses (`169.254.169.254`).
- **Anti-Prompt-Injection**: Strips chat template markers (`<|im_start|>`, `[INST]`, `system:`) from untrusted web pages before feeding into prompts.
- **Ownership Isolation**: Every kit query enforces `userId: req.user.id`.

---

## Testing

Run the automated test suite:
```bash
npm test
```

The test suite covers:
- Schedule allocation arithmetic
- Deterministic coverage & 2-pass gap detection
- Appendix A structure validation
- Batch evaluation CLI input/output
- Regeneration state preservation
- SSRF and security controls
- Resilience against rate limits, timeouts, and malformed JSON
