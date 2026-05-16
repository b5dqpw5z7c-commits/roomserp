import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { query } from './db.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { accountsRouter } from './routes/accounts.js';
import { accountingRouter } from './routes/accounting.js';
import { ordersRouter } from './routes/orders.js';
import { inventoryRouter } from './routes/inventory.js';
import { purchasesRouter } from './routes/purchases.js';
import { hrRouter } from './routes/hr.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

assertConfig();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: config.env === 'production'
    ? {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", 'data:'],
          "connect-src": ["'self'"],
          "font-src": ["'self'", 'data:']
        }
      }
    : false
}));
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use('/api', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, service: 'rooms-erp-cloud-mvp-v2', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/accounting', accountingRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/hr', hrRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);

// Unknown API paths must return JSON, not the SPA HTML.
app.use('/api', notFoundHandler);

app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use(errorHandler);

app.listen(config.port, () => console.log(`ROOM'S ERP Cloud v2 listening on ${config.port}`));
