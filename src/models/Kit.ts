import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { validateKit, KitValidationError } from '../domain/kit.validator.js';
import type { InterviewKit } from '../domain/kit.types.js';

export interface IKitDocument extends Document, Omit<InterviewKit, 'id' | 'user_id'> {
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const requirementSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    kind: { type: String, enum: ['technical', 'behavioural', 'domain'], required: true },
    priority: { type: String, enum: ['must', 'nice'], required: true },
  },
  { _id: false }
);

const questionSchema = new Schema(
  {
    id: { type: String, required: true },
    requirement_ids: [{ type: String, required: true }],
    category: {
      type: String,
      enum: ['technical', 'behavioural', 'system-design', 'company-fit'],
      required: true,
    },
    prompt: { type: String, required: true },
    answer_outline: { type: Schema.Types.Mixed, required: true },
    difficulty: { type: Number, enum: [1, 2, 3], required: true },
    item_status: { type: String, enum: ['generated', 'edited', 'manual'], default: 'generated' },
    isPinned: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

const flashcardSchema = new Schema(
  {
    id: { type: String, required: true },
    front: { type: String, required: true },
    back: { type: String, required: true },
    requirement_ids: [{ type: String, required: true }],
    item_status: { type: String, enum: ['generated', 'edited', 'manual'], default: 'generated' },
    isPinned: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
  },
  { _id: false }
);

const scheduleDaySchema = new Schema(
  {
    day: { type: Number, required: true },
    focus: { type: String, required: true },
    question_ids: [{ type: String, required: true }],
    minutes: { type: Number, required: true },
  },
  { _id: false }
);

const kitSchema = new Schema<IKitDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    source: {
      company: { type: String, required: true },
      company_url: { type: String, required: true },
      role: { type: String, required: true },
      location: { type: String, required: true },
      jd_chars: { type: Number, required: true, min: 0 },
      researched_at: { type: String, required: true },
      pages_used: [{ type: String }],
    },
    company_brief: {
      summary: { type: String, required: true },
      what_they_do: { type: String, required: true },
      sources: [{ type: String }],
      item_status: { type: String, enum: ['generated', 'edited', 'manual'], default: 'generated' },
      isEdited: { type: Boolean, default: false },
      version: { type: Number, default: 1 },
    },
    role: {
      title: { type: String, required: true },
      seniority: { type: String, required: true },
      responsibilities: [{ type: String }],
      requirements: [requirementSchema],
    },
    questions: [questionSchema],
    flashcards: [flashcardSchema],
    schedule: {
      days_available: { type: Number, required: true, min: 1 },
      days: [scheduleDaySchema],
    },
    coverage: {
      uncovered_requirement_ids: [{ type: String }],
      passes: { type: Number, required: true, min: 1 },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, any>) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret.user_id = ret.userId ? ret.userId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Enforce deterministic Appendix A validation before saving
kitSchema.pre('validate', function () {
  const kitData = this.toObject();
  const validationResult = validateKit(kitData);
  if (!validationResult.valid) {
    throw new KitValidationError(validationResult.errors);
  }
});

export const Kit: Model<IKitDocument> =
  (mongoose.models.Kit as Model<IKitDocument>) || mongoose.model<IKitDocument>('Kit', kitSchema);
