import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ICardProgress {
  cardId: string;
  confidence: ConfidenceLevel;
  rating: 1 | 2 | 3;
  reviewCount: number;
  lastReviewedAt: Date;
}

export interface IPracticeProgressDocument extends Document {
  userId: Types.ObjectId;
  kitId: Types.ObjectId;
  cards: ICardProgress[];
  totalSessions: number;
  lastSessionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const cardProgressSchema = new Schema(
  {
    cardId: { type: String, required: true },
    confidence: { type: String, enum: ['low', 'medium', 'high'], required: true },
    rating: { type: Number, enum: [1, 2, 3], required: true },
    reviewCount: { type: Number, default: 1, min: 1 },
    lastReviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const practiceProgressSchema = new Schema<IPracticeProgressDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    kitId: {
      type: Schema.Types.ObjectId,
      ref: 'Kit',
      required: [true, 'kitId is required'],
      index: true,
    },
    cards: [cardProgressSchema],
    totalSessions: { type: Number, default: 0, min: 0 },
    lastSessionAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// One progress record per user per kit
practiceProgressSchema.index({ userId: 1, kitId: 1 }, { unique: true });

export const PracticeProgress: Model<IPracticeProgressDocument> =
  mongoose.models.PracticeProgress ||
  mongoose.model<IPracticeProgressDocument>('PracticeProgress', practiceProgressSchema);
