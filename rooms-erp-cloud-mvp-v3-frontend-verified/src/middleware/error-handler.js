import { AppError } from '../errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, message: `Endpoint bulunamadı: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(error, _req, res, _next) {
  const isZod = error?.name === 'ZodError';
  const status = isZod ? 400 : (error instanceof AppError ? error.status : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    ok: false,
    message: error.message || 'Beklenmeyen hata',
    details: error.details || (isZod ? error.flatten?.() : undefined)
  });
}
