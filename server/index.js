import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import { authenticate, requireAdmin, optionalAuth } from './middleware/auth.js';

// Routes
import authRoutes from './routes/auth.js';
import workstreamRoutes from './routes/workstreams.js';
import articleRoutes from './routes/articles.js';
import classifyRoutes from './routes/classify.js';
import exportRoutes from './routes/export.js';
import quoteRoutes from './routes/quotes.js';
import reporterRoutes from './routes/reporters.js';
import quoteExportRoutes from './routes/quoteExport.js';
import ingestUrlRoutes from './routes/ingestUrls.js';
import narrativeRoutes from './routes/narratives.js';
import analyticsRoutes from './routes/analytics.js';
import watchlistRoutes from './routes/watchlist.js';
import briefingRoutes from './routes/briefings.js';
import talkingPointRoutes from './routes/talkingPoints.js';
import outletTierRoutes from './routes/outletTiers.js';
import strategyRoutes from './routes/strategy.js';
import networkRoutes from './routes/network.js';
import calendarRoutes from './routes/calendar.js';
import parseArticleRoutes from './routes/parseArticles.js';
import extractQuoteRoutes from './routes/extractQuotes.js';
import driftRoutes from './routes/drift.js';
import activityRoutes from './routes/activity.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Auth routes (no auth required)
app.use('/api/auth', authRoutes);

// All other API routes use auth middleware
// In local dev (no JWT_SECRET), auth is bypassed and user is auto-admin
app.use('/api/workstreams', authenticate, workstreamRoutes);
app.use('/api/articles', authenticate, articleRoutes);
app.use('/api/articles/ingest-urls', authenticate, ingestUrlRoutes);
app.use('/api/classify', authenticate, classifyRoutes);
app.use('/api/export', authenticate, exportRoutes);
app.use('/api/export', authenticate, quoteExportRoutes);
app.use('/api/quotes', authenticate, quoteRoutes);
app.use('/api/reporters', authenticate, reporterRoutes);
app.use('/api/narratives', authenticate, narrativeRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/watchlist', authenticate, watchlistRoutes);
app.use('/api/briefings', authenticate, briefingRoutes);
app.use('/api/talking-points', authenticate, talkingPointRoutes);
app.use('/api/outlet-tiers', authenticate, outletTierRoutes);
app.use('/api/strategy', authenticate, strategyRoutes);
app.use('/api/network', authenticate, networkRoutes);
app.use('/api/calendar', authenticate, calendarRoutes);
app.use('/api/drift', authenticate, driftRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/articles/parse', authenticate, parseArticleRoutes);
app.use('/api/extract-quotes', authenticate, extractQuoteRoutes);

// Serve React build (always, not just production — handles Railway and any built deployment)
import { existsSync } from 'fs';
const distPath = join(__dirname, '../client/dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
  console.log('Serving frontend from client/dist');
} else {
  app.get('/', (req, res) => res.json({ status: 'API running', frontend: 'not built — run npm run build' }));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// redeploy 1774817331
