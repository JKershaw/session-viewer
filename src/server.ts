import 'dotenv/config';
import { createApp } from './api/app.js';
import { createSessionRepository } from './db/sessions.js';
import { createTicketRepository } from './db/tickets.js';
import { createTrustRepository } from './db/trust.js';
import { createJobQueue } from './queue/jobs.js';
import { createJobProcessor } from './queue/processor.js';
import { loadConfig } from './config.js';

const main = async () => {
  const config = loadConfig();

  console.log('Starting Claude Code Session Analyzer...');
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Logs directory: ${config.logsDir}`);

  const sessionRepo = await createSessionRepository(config.dataDir);
  const ticketRepo = createTicketRepository();
  const trustRepo = await createTrustRepository(config.dataDir);
  const jobQueue = await createJobQueue();
  const jobProcessor = createJobProcessor(jobQueue, sessionRepo);

  const app = createApp(
    { sessions: sessionRepo, tickets: ticketRepo, trust: trustRepo },
    { logsDir: config.logsDir },
    jobQueue
  );

  // Start job processor
  jobProcessor.start();

  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });
};

main().catch(console.error);
