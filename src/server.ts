import 'dotenv/config';
import { createApp } from './api/app.js';
import { createSessionRepository } from './db/sessions.js';
import { createTicketRepository } from './db/tickets.js';
import { createTrustRepository } from './db/trust.js';
import { createDispatchRepository } from './db/dispatch.js';
import { createDispatchSettingsRepository } from './db/dispatch-settings.js';
import { createJobQueue } from './queue/jobs.js';
import { createJobProcessor } from './queue/processor.js';
import { loadConfig } from './config.js';
import { getDispatchConfig, createDispatchClient } from './dispatch/client.js';
import { createAutoClaimPoller, type AutoClaimPoller } from './dispatch/auto-claim-poller.js';

const main = async () => {
  const config = loadConfig();

  console.log('Starting Claude Code Session Analyzer...');
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Logs directory: ${config.logsDir}`);

  const dispatchConfig = getDispatchConfig();
  console.log(`Dispatch configured: ${dispatchConfig ? 'yes' : 'no'}${dispatchConfig ? ` (${dispatchConfig.baseUrl})` : ''}`);

  const sessionRepo = await createSessionRepository(config.dataDir);
  const ticketRepo = createTicketRepository();
  const trustRepo = await createTrustRepository(config.dataDir);
  const dispatchRepo = createDispatchRepository();
  const dispatchSettingsRepo = createDispatchSettingsRepository(config.dataDir);
  const jobQueue = await createJobQueue();
  const jobProcessor = createJobProcessor(jobQueue, sessionRepo);

  // Initialize auto-claim poller if dispatch is configured
  let autoClaimPoller: AutoClaimPoller | undefined;
  if (dispatchConfig) {
    const dispatchClient = createDispatchClient(dispatchConfig);
    autoClaimPoller = createAutoClaimPoller({
      dispatchClient,
      dispatchRepo,
      settingsRepo: dispatchSettingsRepo
    });
  }

  const app = createApp(
    {
      sessions: sessionRepo,
      tickets: ticketRepo,
      trust: trustRepo,
      dispatch: dispatchRepo,
      dispatchSettings: dispatchSettingsRepo
    },
    { logsDir: config.logsDir },
    jobQueue,
    autoClaimPoller
  );

  // Start job processor
  jobProcessor.start();

  // Start auto-claim poller if enabled in settings
  if (autoClaimPoller) {
    const settings = await dispatchSettingsRepo.getSettings();
    if (settings.enabled) {
      await autoClaimPoller.start();
    }
  }

  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });
};

main().catch(console.error);
