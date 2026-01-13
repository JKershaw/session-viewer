import 'dotenv/config';
import { createApp } from './api/app.js';
import { createSessionRepository } from './db/sessions.js';
import { loadConfig } from './config.js';

const main = async () => {
  const config = loadConfig();

  console.log('Starting Claude Code Session Analyzer...');
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Logs directory: ${config.logsDir}`);

  const sessionRepo = await createSessionRepository(config.dataDir);
  const app = createApp(sessionRepo, { logsDir: config.logsDir });

  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });
};

main().catch(console.error);
