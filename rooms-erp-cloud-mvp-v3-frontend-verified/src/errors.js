export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, message, details);
export const unauthorized = (message = 'Oturum gerekli') => new AppError(401, message);
export const forbidden = (message = 'Bu işlem için yetkiniz yok') => new AppError(403, message);
export const notFound = (message = 'Kayıt bulunamadı') => new AppError(404, message);
export const conflict = (message, details) => new AppError(409, message, details);
