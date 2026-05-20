import { Router, Request, Response } from 'express';
import { login, AuthError } from './auth.service';

export const authRouter = Router();

// POST /auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password, tenantSlug } = req.body as {
    email: string;
    password: string;
    tenantSlug: string;
  };

  if (!email || !password || !tenantSlug) {
    res.status(400).json({ error: 'email, password, and tenantSlug are required' });
    return;
  }

  try {
    const result = await login(email, password, tenantSlug);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
authRouter.post('/logout', (_req: Request, res: Response) => {
  res.status(200).json({ message: 'Logged out' });
});
