import { createApp } from './app.js';
import { config } from './config.js';
import { connectToDatabase } from './db.js';

const startServer = async (): Promise<void> => {
  await connectToDatabase();

  createApp().listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });
};

startServer().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
