import * as dotenv from 'dotenv';
dotenv.config({ override: true }); // backend/.env is the source of truth when present;
                                   // in production no .env ships — secrets come from the environment
import { z } from 'zod';

/**
 * Central, validated runtime configuration.
 * All secrets come from environment variables (never hard-coded).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string',
    ),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('*'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  APP_TIMEZONE: z.string().default('Asia/Tehran'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('   See backend/.env.example for the expected variables.');
  process.exit(1);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV === 'development';
