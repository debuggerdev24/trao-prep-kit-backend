import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

let hasWarnedJwt = false;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    if (!hasWarnedJwt) {
      console.warn('[SECURITY] JWT_SECRET not set — using insecure development fallback. Set JWT_SECRET in production!');
      hasWarnedJwt = true;
    }
    return 'trao_jwt_secret_dev_key_2026';
  }
  return secret;
}

const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN as SignOptions['expiresIn']) || '7d';

export function generateToken(user: AuthUser): string {
  const options: SignOptions = {
    expiresIn: JWT_EXPIRES_IN,
  };
  return jwt.sign({ userId: user.id, email: user.email }, getJwtSecret(), options);
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication token required',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
    (req as AuthRequest).user = {
      id: decoded.userId,
      email: decoded.email,
    };
    next();
  } catch (err: unknown) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
    });
  }
}
