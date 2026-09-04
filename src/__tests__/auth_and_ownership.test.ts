import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../index.js';
import { connectDB, disconnectDB } from '../db.js';
import { User } from '../models/User.js';
import { Kit } from '../models/Kit.js';

function getSampleValidKit() {
  return {
    source: {
      company: 'Acme Test Corp',
      company_url: 'https://acme.example.com',
      role: 'Full Stack Engineer',
      location: 'Remote',
      jd_chars: 1200,
      researched_at: new Date().toISOString(),
      pages_used: ['https://acme.example.com/about'],
    },
    company_brief: {
      summary: 'Acme builds developer productivity platforms.',
      what_they_do: 'Software development tools and enterprise workflows.',
      sources: ['https://acme.example.com/about'],
    },
    role: {
      title: 'Full Stack Engineer',
      seniority: 'Mid-Senior',
      responsibilities: ['Build APIs and user interfaces', 'Scale database clusters'],
      requirements: [
        {
          id: 'r1',
          text: 'Proficiency in Node.js and TypeScript',
          kind: 'technical',
          priority: 'must',
        },
        {
          id: 'r2',
          text: 'Proficiency in modern React',
          kind: 'technical',
          priority: 'must',
        },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain asynchronous programming patterns in Node.js.',
        answer_outline: 'Callbacks, Promises, async/await, event loop microtasks.',
        difficulty: 2,
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'technical',
        prompt: 'How does React Fiber handle scheduling?',
        answer_outline: 'Time-slicing, concurrent mode, priority queues.',
        difficulty: 2,
      },
    ],
    flashcards: [
      {
        id: 'fc1',
        front: 'What is a Promise in JavaScript?',
        back: 'An object representing the eventual completion of an asynchronous operation.',
        requirement_ids: ['r1'],
      },
    ],
    schedule: {
      days_available: 2,
      days: [
        {
          day: 1,
          focus: 'Backend Foundations',
          question_ids: ['q1'],
          minutes: 45,
        },
        {
          day: 2,
          focus: 'Frontend Architecture',
          question_ids: ['q2'],
          minutes: 45,
        },
      ],
    },
    coverage: {
      uncovered_requirement_ids: [],
      passes: 1,
    },
  };
}

describe('Authentication & Kit Ownership Isolation (Phase 1)', () => {
  const userAData = {
    name: 'Alice Engineer',
    email: `alice_${Date.now()}@example.com`,
    password: 'Password123!',
  };

  const userBData = {
    name: 'Bob Developer',
    email: `bob_${Date.now()}@example.com`,
    password: 'Password456!',
  };

  let tokenA = '';
  let tokenB = '';
  let kitAId = '';

  before(async () => {
    await connectDB();
  });

  after(async () => {
    // Clean up test users and kits created during test run
    if (userAData.email) await User.deleteOne({ email: userAData.email });
    if (userBData.email) await User.deleteOne({ email: userBData.email });
    if (kitAId) await Kit.deleteOne({ _id: kitAId });
    await disconnectDB();
  });

  describe('User Registration & Validation', () => {
    it('successfully registers User A and returns a JWT token', async () => {
      const res = await request(app).post('/api/auth/register').send(userAData);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.email, userAData.email.toLowerCase());
      assert.strictEqual(res.body.user.name, userAData.name);
      assert.strictEqual(res.body.user.passwordHash, undefined, 'passwordHash must never be exposed');
      tokenA = res.body.token;
    });

    it('rejects registration with a duplicate email (409 Conflict)', async () => {
      const res = await request(app).post('/api/auth/register').send(userAData);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, 'Email is already registered');
    });

    it('rejects registration with a short password (< 6 characters)', async () => {
      const res = await request(app).post('/api/auth/register').send({
        name: 'Short Pass User',
        email: `short_${Date.now()}@example.com`,
        password: '123',
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('at least 6 characters'));
    });
  });

  describe('User Login & Session Handling', () => {
    it('successfully authenticates with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: userAData.email,
        password: userAData.password,
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.strictEqual(res.body.user.email, userAData.email.toLowerCase());
    });

    it('rejects login with an invalid password (401 Unauthorized)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: userAData.email,
        password: 'WrongPassword!',
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid email or password');
    });

    it('rejects login for a non-existent email (401 Unauthorized)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nobody_exists_here_999@example.com',
        password: 'Password123!',
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Invalid email or password');
    });
  });

  describe('Protected Route Rejection', () => {
    it('rejects /api/auth/me without a Bearer token (401 Unauthorized)', async () => {
      const res = await request(app).get('/api/auth/me');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
    });

    it('rejects /api/kits without a Bearer token (401 Unauthorized)', async () => {
      const res = await request(app).get('/api/kits');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
    });

    it('returns authenticated user profile when token is provided', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.email, userAData.email.toLowerCase());
    });
  });

  describe('Kit Ownership & Cross-User Isolation Strategy', () => {
    before(async () => {
      // Register User B to test cross-user isolation
      const resB = await request(app).post('/api/auth/register').send(userBData);
      assert.strictEqual(resB.status, 201);
      tokenB = resB.body.token;
    });

    it('allows User A to create a kit conforming to Appendix A', async () => {
      const sampleKit = getSampleValidKit();
      const res = await request(app)
        .post('/api/kits')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(sampleKit);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.kit.id);
      kitAId = res.body.kit.id;
      assert.strictEqual(res.body.kit.role.title, 'Full Stack Engineer');
    });

    it('allows User A to retrieve their own Kit A', async () => {
      const res = await request(app)
        .get(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.kit.id, kitAId);
    });

    it('shows Kit A in User A kit list', async () => {
      const res = await request(app)
        .get('/api/kits')
        .set('Authorization', `Bearer ${tokenA}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.kits.some((k: any) => k.id === kitAId));
    });

    it('does NOT show Kit A in User B kit list', async () => {
      const res = await request(app)
        .get('/api/kits')
        .set('Authorization', `Bearer ${tokenB}`);

      assert.strictEqual(res.status, 200);
      assert.ok(!res.body.kits.some((k: any) => k.id === kitAId));
    });

    it('rejects User B attempting to read User A Kit A with 404 (anti-enumeration)', async () => {
      const res = await request(app)
        .get(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      // Consistent authorization strategy: returns 404 Not Found to prevent resource enumeration
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Kit not found');
    });

    it('rejects User B attempting to update User A Kit A with 404 (anti-enumeration)', async () => {
      const res = await request(app)
        .patch(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ title: 'Hacked Title' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Kit not found');
    });

    it('rejects User B attempting to delete User A Kit A with 404 (anti-enumeration)', async () => {
      const res = await request(app)
        .delete(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'Kit not found');

      // Verify Kit A still exists for User A
      const verifyRes = await request(app)
        .get(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      assert.strictEqual(verifyRes.status, 200);
    });

    it('allows User A to delete their own Kit A', async () => {
      const res = await request(app)
        .delete(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.message, 'Kit deleted successfully');

      // Verify it is now deleted
      const checkRes = await request(app)
        .get(`/api/kits/${kitAId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      assert.strictEqual(checkRes.status, 404);
    });
  });
});
