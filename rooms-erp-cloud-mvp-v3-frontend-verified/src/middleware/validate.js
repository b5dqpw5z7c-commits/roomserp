import { badRequest } from '../errors.js';

export function validate(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return next(badRequest('Geçersiz veri', parsed.error.flatten()));
    req.body = parsed.data;
    next();
  };
}
