import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.routes.js';
import kitRoutes from './routes/kit.routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';

// Security headers
app.use(helmet());

// Body size limits
app.use(express.json({ limit: '512kb' }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(globalLimiter);

// Stricter rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' },
});
app.use('/api/auth', authLimiter);

// Generation endpoint rate limiter (resource-intensive)
const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Generation rate limit exceeded, please try again later' },
});
app.use('/api/kits/generate', generationLimiter);

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

// Public Health endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/kits', kitRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Auto-connect to database and listen if not in a test environment
const isTestEnv =
  process.env.NODE_ENV === 'test' ||
  process.env.npm_lifecycle_event === 'test';

if (!isTestEnv) {
  process.stdout.write(`[Server] Starting on port ${port}...\n`);

  connectDB()
    .then(() => {
      process.stdout.write('[Server] Database connected\n');
      startServer();
    })
    .catch((err) => {
      process.stderr.write(`[Server] MongoDB connection failed: ${err.message}\n`);
      process.stderr.write('[Server] Starting server WITHOUT database\n');
      startServer();
    });

  function startServer() {
    const server = app.listen(port, () => {
      process.stdout.write(`[Server] Ready at http://localhost:${port}\n`);
      process.stdout.write(`[Server] Health check: http://localhost:${port}/api/health\n`);
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(`[Server] Port ${port} is already in use\n`);
        process.stderr.write(`[Server] Kill the other process or change PORT in .env\n`);
      } else {
        process.stderr.write(`[Server] Error: ${err.message}\n`);
      }
      process.exit(1);
    });
  }
}

export default app;