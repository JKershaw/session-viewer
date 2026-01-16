import express, { type Express, type Request, type Response } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionRepository } from '../db/sessions.js';
import type { TicketRepository } from '../db/tickets.js';
import type { TrustRepository } from '../db/trust.js';
import type { JobQueue } from '../queue/jobs.js';
import type { ScanConfig } from '../parser/scanner.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createJobRoutes } from './routes/jobs.js';
import { createTicketRoutes } from './routes/tickets.js';
import { createLinearRoutes } from './routes/linear.js';
import { createRefreshRoutes } from './routes/refresh.js';
import { createTrustRoutes } from './routes/trust.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface AppConfig extends ScanConfig {
  staticDir?: string;
  viewsDir?: string;
}

export interface AppRepositories {
  sessions: SessionRepository;
  tickets?: TicketRepository;
  trust?: TrustRepository;
}

export const createApp = (
  repos: AppRepositories,
  config: AppConfig = {},
  jobQueue?: JobQueue
): Express => {
  const app = express();

  app.use(express.json());

  // Configure EJS view engine
  const viewsDir = config.viewsDir ?? join(__dirname, '..', 'views');
  app.set('view engine', 'ejs');
  app.set('views', viewsDir);

  // Serve static files from public directory (disable index.html - we use EJS)
  const staticDir = config.staticDir ?? join(process.cwd(), 'public');
  app.use(express.static(staticDir, { index: false }));

  // Mount API routes
  app.use('/api/sessions', createSessionRoutes({
    sessionRepo: repos.sessions,
    jobQueue
  }));

  app.use('/api/jobs', createJobRoutes(jobQueue));

  app.use('/api/tickets', createTicketRoutes(repos.tickets));

  app.use('/api/linear', createLinearRoutes({
    sessionRepo: repos.sessions,
    ticketRepo: repos.tickets
  }));

  app.use('/api/refresh', createRefreshRoutes({
    sessionRepo: repos.sessions,
    scanConfig: config
  }));

  // Trust analysis routes (only if trust repo available)
  if (repos.trust) {
    app.use('/api/trust', createTrustRoutes({
      sessionRepo: repos.sessions,
      trustRepo: repos.trust,
      ticketRepo: repos.tickets
    }));
  }

  // Error handler
  app.use(errorHandler);

  // Main page - EJS rendered
  app.get('/', async (req: Request, res: Response) => {
    try {
      // Validate view parameter against whitelist
      const VALID_VIEWS = ['timeline', 'trust-dashboard'] as const;
      const requestedView = req.query.view as string;
      const view = VALID_VIEWS.includes(requestedView as typeof VALID_VIEWS[number])
        ? requestedView
        : 'timeline';

      // Extract and validate filters from query params
      const rawZoom = parseInt(req.query.zoom as string);
      const filters = {
        dateFrom: (req.query.dateFrom as string) || '',
        dateTo: (req.query.dateTo as string) || '',
        folder: (req.query.folder as string) || '',
        branch: (req.query.branch as string) || '',
        ticket: (req.query.ticket as string) || '',
        zoom: isNaN(rawZoom) ? 10 : Math.max(1, Math.min(500, rawZoom))
      };

      // Fetch sessions
      const sessionsResult = await repos.sessions.getSessions({ limit: 10000, offset: 0 });
      const sessions = sessionsResult.data;

      // Extract filter options
      const folders = new Set<string>();
      const branches = new Set<string>();
      const tickets = new Set<string>();

      sessions.forEach(session => {
        if (session.folder) folders.add(session.folder);
        if (session.branch) branches.add(session.branch);
        if (session.linearTicketId) tickets.add(session.linearTicketId);
      });

      // Fetch trust map if on dashboard
      let trustMap = null;
      if (view === 'trust-dashboard' && repos.trust) {
        trustMap = await repos.trust.getTrustMap();
      }

      res.render('index', {
        title: 'Claude Code Session Analyzer',
        view,
        filters,
        filterOptions: {
          folders: Array.from(folders).sort(),
          branches: Array.from(branches).sort(),
          tickets: Array.from(tickets).sort()
        },
        sessions,
        trustMap
      });
    } catch (error) {
      console.error('Error rendering view:', error);
      res.status(500).send('Error rendering view');
    }
  });

  return app;
};
