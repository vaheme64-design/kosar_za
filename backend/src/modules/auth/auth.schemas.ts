import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(3, 'Username is too short').max(64),
  password: z.string().min(6, 'Password is too short').max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
