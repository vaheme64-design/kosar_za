import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { login, me } from './auth.controller';

export const authRouter = Router();

authRouter.post('/login', login);
authRouter.get('/me', authenticate, me);
