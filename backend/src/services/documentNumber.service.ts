import { Prisma } from '@prisma/client';
import { db } from '../config/db';
import { ApiError } from '../lib/http';
import { currentJalaliYear } from '../lib/jalali';

interface SequenceRow {
  key: string;
  prefix: string;
  next_number: number;
  pad_length: number;
  reset_policy: 'NEVER' | 'YEARLY';
  last_reset_year: number | null;
}

/**
 * Atomically allocate the next document number for a sequence key
 * (INV, MO, PP, CO, PR, TRF, ...).
 *
 * Uses SELECT ... FOR UPDATE inside the caller's transaction so that two
 * concurrent postings can never receive the same number. Callers MUST pass
 * the Prisma transaction client so the allocation commits (or rolls back)
 * together with the document itself.
 */
export async function generateDocumentNumber(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<string> {
  const rows = await tx.$queryRaw<SequenceRow[]>`
    SELECT key, prefix, next_number, pad_length, reset_policy, last_reset_year
      FROM "document_sequences"
     WHERE key = ${key}
       FOR UPDATE`;

  const seq = rows[0];
  if (!seq) {
    throw new ApiError(500, `Document sequence "${key}" is not configured`, `دنباله شماره‌گذاری «${key}» تعریف نشده است`, 'sequence_not_found');
  }

  let number = seq.next_number;
  const jYear = currentJalaliYear();

  if (seq.reset_policy === 'YEARLY' && seq.last_reset_year !== jYear) {
    number = 1;
    await tx.$executeRaw`
      UPDATE "document_sequences"
         SET next_number = ${number + 1}, last_reset_year = ${jYear}, updated_at = now()
       WHERE key = ${key}`;
  } else {
    await tx.$executeRaw`
      UPDATE "document_sequences"
         SET next_number = ${number + 1}, updated_at = now()
       WHERE key = ${key}`;
  }

  return `${seq.prefix}-${String(number).padStart(seq.pad_length, '0')}`;
}

/** Non-transactional convenience wrapper (for tools/tests only). */
export async function generateDocumentNumberStandalone(key: string): Promise<string> {
  return db.$transaction((tx) => generateDocumentNumber(tx, key));
}
