import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  regenerateKitSection,
  isItemPreserved,
} from '../services/regeneration/index.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';
import type { InterviewKit, Question, Requirement } from '../domain/kit.types.js';

const SAMPLE_REQUIREMENTS: Requirement[] = [
  { id: 'r1', text: 'Expert React & TypeScript development', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentorship and leadership communication', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Distributed microservices architecture', kind: 'technical', priority: 'must' },
];

function buildMockKit(overrides?: Partial<InterviewKit>): InterviewKit {
  return {
    source: {
      company: 'Acme Corp',
      company_url: 'https://example.com',
      role: 'Staff Full-Stack Engineer',
      location: 'San Francisco, CA',
      jd_chars: 1200,
      researched_at: new Date().toISOString(),
      pages_used: ['https://example.com', 'https://example.com/about'],
    },
    company_brief: {
      summary: 'Acme Corp provides developer productivity platforms.',
      what_they_do: 'Cloud developer tools and collaborative SDKs.',
      sources: ['https://example.com'],
      item_status: 'generated',
      isEdited: false,
      version: 1,
    },
    role: {
      title: 'Staff Full-Stack Engineer',
      seniority: 'Staff',
      responsibilities: [
        'Lead frontend and backend systems',
        'Mentor mid-level engineers',
      ],
      requirements: SAMPLE_REQUIREMENTS,
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain React 19 server actions and suspense boundaries.',
        answer_outline: 'Server actions, streaming SSR, suspense fallback',
        difficulty: 2,
        item_status: 'generated',
        isPinned: false,
        isEdited: false,
        isCustom: false,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Tell me about a time you mentored an engineer who was struggling.',
        answer_outline: 'STAR: Situation, Task, Action (pairing, feedback), Result',
        difficulty: 1,
        item_status: 'generated',
        isPinned: false,
        isEdited: false,
        isCustom: false,
      },
      {
        id: 'q3',
        requirement_ids: ['r3'],
        category: 'system-design',
        prompt: 'Design a resilient distributed message queue using PostgreSQL and Redis.',
        answer_outline: 'Partitioning, acknowledgment semantics, backpressure',
        difficulty: 3,
        item_status: 'generated',
        isPinned: false,
        isEdited: false,
        isCustom: false,
      },
    ],
    flashcards: [
      {
        id: 'f1',
        front: 'What is React Fiber?',
        back: 'A reconciliation engine designed to enable incremental rendering of the virtual DOM.',
        requirement_ids: ['r1'],
        item_status: 'generated',
      },
    ],
    schedule: {
      days_available: 3,
      days: [
        { day: 1, focus: 'High Priority Must-Haves', question_ids: ['q3'], minutes: 60 },
        { day: 2, focus: 'Technical Deep Dive', question_ids: ['q1'], minutes: 45 },
        { day: 3, focus: 'Behavioural & Core Review', question_ids: ['q2'], minutes: 30 },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
    ...overrides,
  };
}

function makeMockCandidatesResponse(candidates: Question[]) {
  return JSON.stringify({
    questions: candidates.map((c) => ({
      requirement_ids: c.requirement_ids,
      category: c.category,
      prompt: c.prompt,
      answer_outline: c.answer_outline,
      difficulty: c.difficulty,
    })),
  });
}

describe('Robust Editing, Reordering and Regeneration State (Phase 11)', () => {
  describe('State Metadata & Preservation Predicate', () => {
    it('identifies edited questions as preserved', () => {
      const q: Question = {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Custom text',
        answer_outline: 'Custom outline',
        difficulty: 2,
        item_status: 'edited',
        isEdited: true,
      };
      assert.strictEqual(isItemPreserved(q), true);
    });

    it('identifies manual/custom questions as preserved', () => {
      const q: Question = {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Handcrafted question',
        answer_outline: 'Custom',
        difficulty: 3,
        item_status: 'manual',
        isCustom: true,
      };
      assert.strictEqual(isItemPreserved(q), true);
    });

    it('identifies pinned questions as preserved even if otherwise generated', () => {
      const q: Question = {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Generated prompt',
        answer_outline: 'Outline',
        difficulty: 2,
        item_status: 'generated',
        isPinned: true,
      };
      assert.strictEqual(isItemPreserved(q), true);
    });

    it('identifies unpinned, unedited generated questions as replaceable', () => {
      const q: Question = {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Standard prompt',
        answer_outline: 'Standard outline',
        difficulty: 2,
        item_status: 'generated',
        isPinned: false,
        isEdited: false,
        isCustom: false,
      };
      assert.strictEqual(isItemPreserved(q), false);
    });
  });

  // Test 1: Edit question -> regenerate category -> edit survives
  it('Requirement 1: Edit question in category -> regenerate category -> edit survives', async () => {
    const kit = buildMockKit();
    // User edits q1 in 'technical'
    kit.questions[0] = {
      ...kit.questions[0],
      prompt: 'MY HIGHLY SPECIFIC EDITED REACT QUESTION WITH VIRTUAL DOM TRADE-OFFS',
      answer_outline: 'Custom user outline points',
      item_status: 'edited',
      isEdited: true,
      version: 2,
    };

    const mockCandidates: Question[] = [
      {
        id: 'candidate1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Brand new generated React question from candidate generator',
        answer_outline: 'New outline',
        difficulty: 2,
      },
    ];

    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    const result = await regenerateKitSection(
      { kit, section: 'category', category: 'technical' },
      { llmClient: mockClient }
    );

    // Assert: The edited question MUST survive with its exact prompt and metadata
    const survivedEdited = result.kit.questions.find((q) =>
      q.prompt.includes('MY HIGHLY SPECIFIC EDITED REACT QUESTION')
    );
    assert.ok(survivedEdited, 'The user-edited question must survive regeneration');
    assert.strictEqual(survivedEdited?.isEdited, true);
    assert.strictEqual(survivedEdited?.item_status, 'edited');
    assert.strictEqual(survivedEdited?.answer_outline, 'Custom user outline points');
    assert.strictEqual(result.preservedItemsCount >= 1, true);
  });

  // Test 2: Add manual question -> regenerate category -> manual question survives
  it('Requirement 2: Add manual question -> regenerate category -> manual question survives', async () => {
    const kit = buildMockKit();
    // User added a manual question into 'technical'
    const manualQuestion: Question = {
      id: 'q_custom',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'MANUALLY CREATED QUESTION: Explain memory leak profiling in V8',
      answer_outline: 'Heap snapshots, detached DOM trees',
      difficulty: 3,
      item_status: 'manual',
      isCustom: true,
      isPinned: true,
      version: 1,
    };
    kit.questions.push(manualQuestion);

    const mockCandidates: Question[] = [
      {
        id: 'candidate1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Replacement candidate for unpinned technical questions',
        answer_outline: 'Outline',
        difficulty: 1,
      },
    ];

    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    const result = await regenerateKitSection(
      { kit, section: 'category', category: 'technical' },
      { llmClient: mockClient }
    );

    const survivedManual = result.kit.questions.find((q) =>
      q.prompt.includes('MANUALLY CREATED QUESTION')
    );
    assert.ok(survivedManual, 'The manually created question must survive category regeneration');
    assert.strictEqual(survivedManual?.isCustom, true);
    assert.strictEqual(survivedManual?.isPinned, true);
  });

  // Test 3: Delete generated question -> regenerate category -> deletion behavior is deterministic
  it('Requirement 3: Delete generated question -> regenerate category -> deletion behavior is deterministic', async () => {
    const kit = buildMockKit();
    // Initially has 3 questions: q1 (technical), q2 (behavioural), q3 (system-design)
    // Add a second technical question
    const qTech2: Question = {
      id: 'q1_extra',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'DELETED QUESTION CANDIDATE: Outdated React lifecycle methods',
      answer_outline: 'componentWillMount, etc',
      difficulty: 1,
      item_status: 'generated',
    };
    kit.questions.push(qTech2);

    // User deletes qTech2
    const deletedPrompt = 'DELETED QUESTION CANDIDATE: Outdated React lifecycle methods';
    kit.questions = kit.questions.filter((q) => q.prompt !== deletedPrompt);

    // Candidate generator provides a fresh modern question
    const mockCandidates: Question[] = [
      {
        id: 'cand_new',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Modern React 19 useActionState hook mechanisms',
        answer_outline: 'Form actions and optimistic updates',
        difficulty: 2,
      },
    ];

    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    const result = await regenerateKitSection(
      { kit, section: 'category', category: 'technical' },
      { llmClient: mockClient }
    );

    // The deleted prompt MUST NOT be resurrected
    const resurrected = result.kit.questions.find((q) => q.prompt === deletedPrompt);
    assert.strictEqual(resurrected, undefined, 'Deleted question must NOT be resurrected');

    // Referential integrity and valid coverage must be preserved
    assert.strictEqual(result.kit.coverage.uncovered_requirement_ids.length, 0);
  });

  // Test 4: Edit question in category A -> regenerate category B -> A remains untouched
  it('Requirement 4: Edit question in category A -> regenerate category B -> category A remains untouched', async () => {
    const kit = buildMockKit();
    // User edited q1 in 'technical'
    kit.questions[0] = {
      ...kit.questions[0],
      prompt: 'CATEGORY A PROMPT: Advanced TypeScript conditional types and infer keyword',
      item_status: 'edited',
      isEdited: true,
      difficulty: 3,
    };

    // Candidate generator responds with new behavioural questions for category B
    const mockCandidates: Question[] = [
      {
        id: 'b_cand',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'NEW BEHAVIOURAL QUESTION: How do you handle cross-functional conflicts?',
        answer_outline: 'Collaboration, active listening, resolution',
        difficulty: 2,
      },
    ];

    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    // Regenerate Category B ('behavioural')
    const result = await regenerateKitSection(
      { kit, section: 'category', category: 'behavioural' },
      { llmClient: mockClient }
    );

    // Assert: Category A question is 100% untouched
    const catAQuestion = result.kit.questions.find((q) => q.category === 'technical');
    assert.ok(catAQuestion, 'Category A question must still exist');
    assert.strictEqual(catAQuestion?.prompt, 'CATEGORY A PROMPT: Advanced TypeScript conditional types and infer keyword');
    assert.strictEqual(catAQuestion?.isEdited, true);
    assert.strictEqual(catAQuestion?.difficulty, 3);

    // Category B question was regenerated
    const catBQuestion = result.kit.questions.find((q) => q.category === 'behavioural');
    assert.ok(catBQuestion?.prompt.includes('NEW BEHAVIOURAL QUESTION'));
  });

  // Test 5: Edit company brief -> regenerate questions -> brief remains edited
  it('Requirement 5: Edit company brief -> regenerate questions -> brief remains edited', async () => {
    const kit = buildMockKit();
    // User edited company brief
    kit.company_brief = {
      summary: 'USER CUSTOM COMPANY BRIEF: Acme is a stealth AI hardware unicorn.',
      what_they_do: 'Building custom ASIC accelerators for neural synthesis.',
      sources: ['https://example.com/custom-memo'],
      item_status: 'edited',
      isEdited: true,
      version: 3,
    };

    const mockCandidates: Question[] = [
      {
        id: 'tech_new',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Fresh technical question',
        answer_outline: 'Outline',
        difficulty: 2,
      },
    ];

    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    // Regenerate category 'technical'
    const result = await regenerateKitSection(
      { kit, section: 'category', category: 'technical' },
      { llmClient: mockClient }
    );

    // Assert: Company brief is completely intact and unaltered
    assert.strictEqual(
      result.kit.company_brief.summary,
      'USER CUSTOM COMPANY BRIEF: Acme is a stealth AI hardware unicorn.'
    );
    assert.strictEqual(
      result.kit.company_brief.what_they_do,
      'Building custom ASIC accelerators for neural synthesis.'
    );
    assert.strictEqual(result.kit.company_brief.isEdited, true);
    assert.strictEqual(result.kit.company_brief.version, 3);
  });

  // Test 6: Reordering survives unrelated regeneration
  it('Requirement 6: Reordering survives unrelated regeneration', async () => {
    const kit = buildMockKit();
    // Reorder questions: Put behavioural first, then system-design, then technical
    // [q2 (behavioural), q3 (system-design, pinned), q1 (technical)]
    kit.questions = [
      { ...kit.questions[1], isPinned: true }, // behavioural
      { ...kit.questions[2], isPinned: true }, // system-design
      kit.questions[0], // technical
    ];

    // Mock candidates for regenerating company brief
    const resultBrief = await regenerateKitSection(
      { kit, section: 'company_brief' },
      {
        crawlerOptions: {
          allowLocal: true,
        },
      }
    );

    // Questions order must be strictly preserved
    assert.strictEqual(resultBrief.kit.questions[0].category, 'behavioural');
    assert.strictEqual(resultBrief.kit.questions[1].category, 'system-design');
    assert.strictEqual(resultBrief.kit.questions[2].category, 'technical');

    // Now regenerate category 'technical'
    const mockCandidates: Question[] = [
      {
        id: 'new_tech',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Replacement tech question',
        answer_outline: 'Outline',
        difficulty: 2,
      },
    ];
    const mockClient = new MockLanguageModelClient(makeMockCandidatesResponse(mockCandidates));

    const resultCat = await regenerateKitSection(
      { kit: resultBrief.kit, section: 'category', category: 'technical' },
      { llmClient: mockClient }
    );

    // First two questions MUST still be behavioural and system-design in that exact order!
    assert.strictEqual(resultCat.kit.questions[0].category, 'behavioural');
    assert.strictEqual(resultCat.kit.questions[1].category, 'system-design');
    assert.strictEqual(resultCat.kit.questions[2].category, 'technical');
  });
});
