import type { Request, Response } from 'express';
import { loginSchema } from './auth.schemas';
import * as authService from './auth.service';

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input, {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json(result);
}

export async function me(req: Request, res: Response): Promise<void> {
  const profile = await authService.getProfile(req.user!.id);
  res.json({ user: profile });
}
