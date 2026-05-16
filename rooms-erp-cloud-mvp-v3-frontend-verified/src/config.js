import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  appUrl: process.env.APP_URL || 'http://localhost:3001',
  corsOrigin: process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:3001',
  cookieSecure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
  businessTimezone: process.env.BUSINESS_TIMEZONE || 'Europe/Istanbul',
  seedAdminUsername: process.env.SEED_ADMIN_USERNAME || 'admin',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  seedAdminName: process.env.SEED_ADMIN_NAME || "ROOM'S Admin"
};

export function assertConfig() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is required and must be at least 32 characters');
  }
}
