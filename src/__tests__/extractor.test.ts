import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractRequirements,
  sanitizeJsonResponse,
  verifyRequirementGrounding,
  ExtractionError,
} from '../services/extraction/extractor.service.js';
import { MockLanguageModelClient } from '../services/llm/mock.js';

describe('Job Description Requirement Extractor (Phase 3)', () => {
  describe('Normal JD Extraction & Semantic Assertions', () => {
    it('extracts role, responsibilities, and classified requirements with stable IDs', async () => {
      const sampleJD = `
        Senior Backend Engineer - FinTech Payments
        We are seeking a Senior Backend Engineer to join our Payments Infrastructure team.

        Responsibilities:
        - Design and implement low-latency payment processing pipelines.
        - Mentor junior and mid-level engineers in distributed systems design.

        Requirements:
        - 5+ years of production experience with Node.js and TypeScript (Required).
        - Deep understanding of PostgreSQL and relational schema design (Must have).
        - Demonstrated ability to collaborate across distributed remote teams (Essential).
        - Experience with AWS (ECS, Lambda, SQS) is a big plus (Nice to have).
        - Prior domain experience in PCI-DSS or banking protocols is preferred.
      `;

      const mockResponse = JSON.stringify({
        title: 'Senior Backend Engineer - FinTech Payments',
        seniority: 'Senior',
        responsibilities: [
          'Design and implement low-latency payment processing pipelines',
          'Mentor junior and mid-level engineers in distributed systems design',
        ],
        requirements: [
          {
            text: '5+ years of production experience with Node.js and TypeScript',
            kind: 'technical',
            priority: 'must',
          },
          {
            text: 'Deep understanding of PostgreSQL and relational schema design',
            kind: 'technical',
            priority: 'must',
          },
          {
            text: 'Demonstrated ability to collaborate across distributed remote teams',
            kind: 'behavioural',
            priority: 'must',
          },
          {
            text: 'Experience with AWS (ECS, Lambda, SQS)',
            kind: 'technical',
            priority: 'nice',
          },
          {
            text: 'Prior domain experience in PCI-DSS or banking protocols',
            kind: 'domain',
            priority: 'nice',
          },
        ],
      });

      const mockClient = new MockLanguageModelClient(mockResponse);
      const role = await extractRequirements(sampleJD, { llmClient: mockClient });

      assert.strictEqual(role.title, 'Senior Backend Engineer - FinTech Payments');
      assert.strictEqual(role.seniority, 'Senior');
      assert.strictEqual(role.responsibilities.length, 2);
      assert.strictEqual(role.requirements.length, 5);

      // Verify deterministic stable IDs: r1, r2, r3, r4, r5
      assert.strictEqual(role.requirements[0].id, 'r1');
      assert.strictEqual(role.requirements[1].id, 'r2');
      assert.strictEqual(role.requirements[2].id, 'r3');
      assert.strictEqual(role.requirements[3].id, 'r4');
      assert.strictEqual(role.requirements[4].id, 'r5');

      // Semantic mapping assertions:
      // Node.js -> technical + must
      const nodeReq = role.requirements.find((r) => r.text.includes('Node.js'));
      assert.ok(nodeReq);
      assert.strictEqual(nodeReq.kind, 'technical');
      assert.strictEqual(nodeReq.priority, 'must');

      // AWS -> technical + nice
      const awsReq = role.requirements.find((r) => r.text.includes('AWS'));
      assert.ok(awsReq);
      assert.strictEqual(awsReq.kind, 'technical');
      assert.strictEqual(awsReq.priority, 'nice');

      // Collaboration -> behavioural + must
      const collabReq = role.requirements.find((r) => r.text.includes('collaborate'));
      assert.ok(collabReq);
      assert.strictEqual(collabReq.kind, 'behavioural');
      assert.strictEqual(collabReq.priority, 'must');
    });
  });

  describe('Technical vs Behavioural vs Domain Classification', () => {
    it('correctly categorizes kinds of requirements based on JD content', async () => {
      const jd = `
        We need a Full Stack Engineer with strong React and CSS skills.
        You will need clear empathetic written communication when reviewing code.
        Healthcare HIPAA compliance experience is a bonus.
      `;

      const mockResponse = JSON.stringify({
        title: 'Full Stack Engineer',
        seniority: 'Mid',
        responsibilities: ['Build features'],
        requirements: [
          { text: 'React and CSS', kind: 'technical', priority: 'must' },
          { text: 'Clear empathetic written communication', kind: 'behavioural', priority: 'must' },
          { text: 'Healthcare HIPAA compliance experience', kind: 'domain', priority: 'nice' },
        ],
      });

      const mockClient = new MockLanguageModelClient(mockResponse);
      const role = await extractRequirements(jd, { llmClient: mockClient });

      const tech = role.requirements.find((r) => r.text === 'React and CSS');
      const behav = role.requirements.find((r) => r.text === 'Clear empathetic written communication');
      const domain = role.requirements.find((r) => r.text === 'Healthcare HIPAA compliance experience');

      assert.strictEqual(tech?.kind, 'technical');
      assert.strictEqual(behav?.kind, 'behavioural');
      assert.strictEqual(domain?.kind, 'domain');
    });
  });

  describe('Must vs Nice Priority Differentiation', () => {
    it('properly differentiates must-have from nice-to-have qualifications', async () => {
      const jd = `
        Required: Kubernetes production operations.
        Bonus: Terraform certification.
      `;

      const mockResponse = JSON.stringify({
        title: 'DevOps Engineer',
        seniority: 'Senior',
        responsibilities: ['Maintain infrastructure'],
        requirements: [
          { text: 'Kubernetes production operations', kind: 'technical', priority: 'must' },
          { text: 'Terraform certification', kind: 'technical', priority: 'nice' },
        ],
      });

      const mockClient = new MockLanguageModelClient(mockResponse);
      const role = await extractRequirements(jd, { llmClient: mockClient });

      const mustReq = role.requirements.find((r) => r.text.includes('Kubernetes'));
      const niceReq = role.requirements.find((r) => r.text.includes('Terraform'));

      assert.strictEqual(mustReq?.priority, 'must');
      assert.strictEqual(niceReq?.priority, 'nice');
    });
  });

  describe('Deterministic Anti-Hallucination Guard', () => {
    it('discards ungrounded requirements fabricated by the model that have no lexical basis in the JD', async () => {
      const jd = 'Looking for a junior Python developer who knows Django.';

      // Model hallucinates an ungrounded skill (Kubernetes and Rust) not present in the JD
      const mockResponse = JSON.stringify({
        title: 'Junior Python Developer',
        seniority: 'Junior',
        responsibilities: ['Write Django code'],
        requirements: [
          { text: 'Python and Django expertise', kind: 'technical', priority: 'must' },
          { text: 'Production Kubernetes and Rust microservices', kind: 'technical', priority: 'must' }, // Hallucinated!
        ],
      });

      const mockClient = new MockLanguageModelClient(mockResponse);
      const role = await extractRequirements(jd, { llmClient: mockClient });

      // Python and Django should be retained
      assert.ok(role.requirements.some((r) => r.text.includes('Django')));
      // The hallucinated Kubernetes requirement MUST have been pruned by verifyRequirementGrounding
      assert.ok(!role.requirements.some((r) => r.text.includes('Kubernetes')));
    });

    it('verifyRequirementGrounding helper accurately identifies grounded vs ungrounded text', () => {
      const rawText = 'Requires 3+ years of React and Tailwind CSS experience.';
      assert.strictEqual(verifyRequirementGrounding('React experience', rawText), true);
      assert.strictEqual(verifyRequirementGrounding('Tailwind CSS', rawText), true);
      assert.strictEqual(verifyRequirementGrounding('Kubernetes and Golang distributed systems', rawText), false);
    });
  });

  describe('Thin / Short JD Handling', () => {
    it('handles a two-line stub honestly without hallucination', async () => {
      const thinJD = 'Looking for a junior python developer. Needs 1 year of Django.';

      const mockResponse = JSON.stringify({
        title: 'Junior Python Developer',
        seniority: 'Junior',
        responsibilities: [],
        requirements: [
          { text: '1 year of Django experience', kind: 'technical', priority: 'must' },
        ],
      });

      const mockClient = new MockLanguageModelClient(mockResponse);
      const role = await extractRequirements(thinJD, { llmClient: mockClient });

      assert.strictEqual(role.title, 'Junior Python Developer');
      assert.strictEqual(role.seniority, 'Junior');
      assert.strictEqual(role.requirements.length, 1);
      assert.strictEqual(role.requirements[0].id, 'r1');
      assert.strictEqual(role.requirements[0].text, '1 year of Django experience');
      assert.ok(role.responsibilities.length >= 1);
    });
  });

  describe('Malformed Model Response Handling & Sanitization', () => {
    it('sanitizes and parses responses wrapped in markdown code blocks and trailing commas', async () => {
      const rawMarkdown = `
      Here is the extracted information:
      \`\`\`json
      {
        "title": "Staff Architect",
        "seniority": "Staff",
        "responsibilities": ["System design",],
        "requirements": [
          {
            "text": "Enterprise distributed systems",
            "kind": "technical",
            "priority": "must",
          },
        ],
      }
      \`\`\`
      `;

      const sanitized = sanitizeJsonResponse(rawMarkdown);
      assert.doesNotThrow(() => JSON.parse(sanitized));

      const mockClient = new MockLanguageModelClient(rawMarkdown);
      const role = await extractRequirements('Enterprise distributed systems role', { llmClient: mockClient });

      assert.strictEqual(role.title, 'Staff Architect');
      assert.strictEqual(role.requirements[0].id, 'r1');
      assert.strictEqual(role.requirements[0].kind, 'technical');
    });

    it('retries and eventually fails on truly unparseable garbage output', async () => {
      const mockClient = new MockLanguageModelClient('This is not JSON at all');
      await assert.rejects(
        () => extractRequirements('Some JD', { llmClient: mockClient }),
        (err) => err instanceof ExtractionError
      );
    });
  });

  describe('Missing Required Output Fields', () => {
    it('throws ExtractionError when required fields like title or seniority are missing', async () => {
      const missingTitleJson = JSON.stringify({
        seniority: 'Mid',
        responsibilities: ['Code'],
        requirements: [{ text: 'TypeScript', kind: 'technical', priority: 'must' }],
      });

      const mockClient = new MockLanguageModelClient(missingTitleJson);
      await assert.rejects(
        () => extractRequirements('Some JD', { llmClient: mockClient }),
        (err) => err instanceof ExtractionError && err.message.includes('Extracted data failed validation')
      );
    });
  });

  describe('Rate Limiting & Retries', () => {
    it('recovers cleanly when the client encounters a transient 429 rate limit', async () => {
      const validResponse = JSON.stringify({
        title: 'Backend Engineer',
        seniority: 'Mid',
        responsibilities: ['Write APIs'],
        requirements: [{ text: 'Node.js', kind: 'technical', priority: 'must' }],
      });

      // Simulates 1 rate limit failure before returning the valid response
      const mockClient = new MockLanguageModelClient(validResponse, 1);
      const role = await extractRequirements('Node.js backend role', { llmClient: mockClient, maxRetries: 2 });

      assert.strictEqual(role.title, 'Backend Engineer');
      assert.strictEqual(mockClient.callCount, 2);
    });
  });

  describe('Empty Input Handling', () => {
    it('rejects empty or whitespace-only job description', async () => {
      const mockClient = new MockLanguageModelClient('{}');
      await assert.rejects(
        () => extractRequirements('   ', { llmClient: mockClient }),
        (err) => err instanceof ExtractionError && err.message.includes('empty job description')
      );
    });
  });
});
