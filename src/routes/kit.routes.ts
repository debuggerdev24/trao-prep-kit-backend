import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Kit } from '../models/Kit.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { validateKit } from '../domain/kit.validator.js';
import { generateInterviewKit } from '../services/orchestrator/index.js';
import { allocateSchedule } from '../services/schedule/index.js';
import { checkCoverage } from '../services/coverage/index.js';
import { researchCompany } from '../services/crawler/index.js';
import { generateQuestions } from '../services/generation/generation.service.js';
import { regenerateKitSection } from '../services/regeneration/index.js';
import { getPracticeProgress, recordPracticeSession } from '../services/practice/index.js';

const router = Router();

// All kit routes require authentication
router.use(authenticate);

// POST /api/kits/generate - Run full multi-step generation pipeline
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { jd, company_url, days } = req.body || {};

    if (!jd || typeof jd !== 'string' || !jd.trim()) {
      res.status(400).json({ error: 'Job description (jd) is required' });
      return;
    }

    if (!company_url || typeof company_url !== 'string' || !company_url.trim()) {
      res.status(400).json({ error: 'Company URL (company_url) is required' });
      return;
    }

    const daysNum = Number(days);
    if (!Number.isInteger(daysNum) || daysNum < 1) {
      res.status(400).json({ error: 'Days must be an integer >= 1' });
      return;
    }

    const result = await generateInterviewKit({
      jd: jd.trim(),
      company_url: company_url.trim(),
      days: daysNum,
      userId,
      persist: true,
    });

    res.status(201).json({
      kit: result.kit,
      progressHistory: result.progressHistory,
    });
  } catch (err: unknown) {
    console.error('Kit generation route error:', err);
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
      error: 'Kit generation failed',
      message: isDev && err instanceof Error ? err.message : undefined,
    });
  }
});

// POST /api/kits - Create a new interview kit
router.post('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const kitData = req.body;

    // Validate incoming kit data against Appendix A contract
    const validationResult = validateKit(kitData);
    if (!validationResult.valid) {
      res.status(400).json({
        error: 'Kit data failed Appendix A validation',
        details: validationResult.errors,
      });
      return;
    }

    const newKit = await Kit.create({
      ...validationResult.kit,
      userId: new mongoose.Types.ObjectId(userId),
    });

    res.status(201).json({ kit: newKit.toJSON() });
  } catch (err: unknown) {
    console.error('Create kit error:', err);
    res.status(500).json({ error: 'Failed to create kit' });
  }
});

// GET /api/kits - List all kits for the authenticated user
router.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    const kits = await Kit.find({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
    res.status(200).json({ kits: kits.map((k) => k.toJSON()) });
  } catch (err: unknown) {
    console.error('List kits error:', err);
    res.status(500).json({ error: 'Failed to fetch kits' });
  }
});

// GET /api/kits/:id - Fetch single kit
// Security/Auth strategy: Returns 404 if kit does not exist OR does not belong to user (avoids ID enumeration)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const kit = await Kit.findOne({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!kit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    res.status(200).json({ kit: kit.toJSON() });
  } catch (err: unknown) {
    console.error('Get kit error:', err);
    res.status(500).json({ error: 'Failed to fetch kit' });
  }
});

// PATCH /api/kits/:id - Update kit
// Security/Auth strategy: Returns 404 if kit not owned by user
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const existingKit = await Kit.findOne({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!existingKit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const updatedData = {
      ...existingKit.toObject(),
      ...req.body,
    };

    // Strip non-updatable fields to prevent mass assignment
    const { _id, userId: _userId, createdAt, updatedAt, __v, ...safeData } = updatedData;
    const dataToValidate = { ...existingKit.toObject(), ...safeData };

    const validationResult = validateKit(dataToValidate);
    if (!validationResult.valid) {
      res.status(400).json({
        error: 'Updated kit failed Appendix A validation',
        details: validationResult.errors,
      });
      return;
    }

    Object.assign(existingKit, validationResult.kit);
    await existingKit.save();

    res.status(200).json({ kit: existingKit.toJSON() });
  } catch (err: unknown) {
    console.error('Update kit error:', err);
    res.status(500).json({ error: 'Failed to update kit' });
  }
});

// DELETE /api/kits/:id - Delete kit
// Security/Auth strategy: Returns 404 if kit not owned by user
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const deletedKit = await Kit.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!deletedKit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    res.status(200).json({ message: 'Kit deleted successfully' });
  } catch (err: unknown) {
    console.error('Delete kit error:', err);
    res.status(500).json({ error: 'Failed to delete kit' });
  }
});

// POST /api/kits/:id/regenerate-section - Regenerates a specific section while strictly preserving user edits and pinned items
router.post('/:id/regenerate-section', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const existingKit = await Kit.findOne({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!existingKit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const { section, category, currentKit } = req.body || {};
    const baseKit = currentKit || existingKit.toObject();

    const result = await regenerateKitSection({
      kit: baseKit,
      section,
      category,
    });

    Object.assign(existingKit, result.kit);
    await existingKit.save();

    res.status(200).json({
      kit: existingKit.toJSON(),
      regeneratedSection: result.regeneratedSection,
      preservedItemsCount: result.preservedItemsCount,
      replacedItemsCount: result.replacedItemsCount,
    });
  } catch (err: unknown) {
    console.error('Section regeneration route error:', err);
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
      error: 'Failed to regenerate section',
      message: isDev && err instanceof Error ? err.message : undefined,
    });
  }
});

// GET /api/kits/:id/practice - Get practice progress, card ratings, and weak-spot deck ordering
router.get('/:id/practice', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const kit = await Kit.findOne({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!kit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const summary = await getPracticeProgress(userId!, kitId, kit.flashcards);
    res.status(200).json(summary);
  } catch (err: unknown) {
    console.error('Get practice progress error:', err);
    res.status(500).json({ error: 'Failed to fetch practice progress' });
  }
});

// POST /api/kits/:id/practice - Record practice session ratings & update progress
router.post('/:id/practice', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const kitId = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);

    if (!mongoose.Types.ObjectId.isValid(kitId)) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const kit = await Kit.findOne({
      _id: new mongoose.Types.ObjectId(kitId),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!kit) {
      res.status(404).json({ error: 'Kit not found' });
      return;
    }

    const { ratings } = req.body || {};
    if (!Array.isArray(ratings)) {
      res.status(400).json({ error: 'Ratings array is required' });
      return;
    }

    const summary = await recordPracticeSession(userId!, kitId, ratings, kit.flashcards);
    res.status(200).json(summary);
  } catch (err: unknown) {
    console.error('Record practice progress error:', err);
    res.status(500).json({ error: 'Failed to record practice progress' });
  }
});

export default router;

