import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../lib/http';
import { logger } from '../lib/logger';
import { isDev } from '../config/env';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    messageFa: 'مسیر درخواستی یافت نشد',
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      messageFa: err.messageFa,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Invalid request payload',
      messageFa: 'داده‌های ورودی نامعتبر است',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: 'conflict',
        message: 'A record with the same unique value already exists',
        messageFa: 'رکوردی با همین مقدار یکتا از قبل ثبت شده است',
        meta: err.meta,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        error: 'not_found',
        message: 'Record not found',
        messageFa: 'رکورد مورد نظر یافت نشد',
      });
      return;
    }
  }

  logger.error('unhandled error', {
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error ? err.stack : String(err),
  });

  res.status(500).json({
    error: 'internal_error',
    message: 'Internal server error',
    messageFa: 'خطای غیرمنتظره در سرور رخ داده است',
    ...(isDev && err instanceof Error ? { devDetail: err.message } : {}),
  });
}
