import type { QuestionCategory, Requirement } from '../../domain/kit.types.js';

export function buildCategoryPrompt(
  category: QuestionCategory,
  targetRequirements: Requirement[],
  roleTitle: string,
  seniority: string,
  companyContext?: string,
  interviewProcessContext?: string
): string {
  const reqList = targetRequirements
    .map((r) => `  - [ID: ${r.id}] (${r.kind.toUpperCase()}, ${r.priority.toUpperCase()}): "${r.text}"`)
    .join('\n');

  const validIds = targetRequirements.map((r) => r.id).join(', ');

  let categoryGuidance = '';
  switch (category) {
    case 'technical':
      categoryGuidance = `
Focus on deep technical mastery, practical coding patterns, architectural trade-offs, edge-case handling, and ecosystem internals.
Ensure questions test actual real-world production challenges, not textbook trivia.
Difficulty should reflect the seniority (${seniority}).`;
      break;

    case 'behavioural':
      categoryGuidance = `
Focus on real-world behavioral scenarios using the STAR framework (Situation, Task, Action, Result).
Target leadership, conflict resolution, mentoring, cross-functional collaboration, and overcoming technical adversity.`;
      break;

    case 'system-design':
      categoryGuidance = `
Focus on distributed systems design, scalability, trade-offs (CAP theorem, latency vs throughput), microservices, caching, and data modeling.
If relevant public interview rounds mention system design, reflect that depth.`;
      break;

    case 'company-fit':
      categoryGuidance = `
Focus on alignment with the company's product, engineering culture, architectural mission, and team operating principles.
Incorporate the provided company research and interview process observations.`;
      break;
  }

  return `You are a Principal Software Engineering Interviewer designing an interview preparation kit for:
Role: ${roleTitle} (${seniority})
Target Category: ${category.toUpperCase()}

TARGET REQUIREMENTS TO COVER:
${reqList}

${companyContext ? `COMPANY CONTEXT:\n${companyContext}\n` : ''}
${interviewProcessContext ? `INTERVIEW PROCESS & ROUNDS RESEARCH:\n${interviewProcessContext}\n` : ''}

CATEGORY SPECIFIC GUIDELINES:
${categoryGuidance}

CRITICAL RULES:
1. Every question MUST explicitly set "category": "${category}".
2. Every question MUST reference one or more valid requirement IDs from this EXACT list: [${validIds}].
3. NEVER invent or hallucinate requirement IDs that are not in the list above.
4. "difficulty" must be an integer: 1 (fundamental/mid), 2 (advanced/senior), or 3 (staff/principal architectural challenge).
5. "answer_outline" must detail what a top-tier candidate includes (bullet points or comprehensive summary).
6. Return valid JSON only with a top-level "questions" array.

Output format example:
{
  "questions": [
    {
      "requirement_ids": ["${targetRequirements[0]?.id || 'r1'}"],
      "category": "${category}",
      "prompt": "Question text...",
      "answer_outline": "Key points to look for in the response...",
      "difficulty": 2
    }
  ]
}`;
}
