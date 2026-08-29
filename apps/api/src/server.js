/**
 * Process entry point: builds the real container, boots the Express app,
 * and shuts down gracefully on SIGTERM (closes the HTTP server, then the pg pool).
 */
import { createContainer } from './container.js';
import { createApp } from './app.js';

const container = createContainer();
const app = createApp(container);

const server = app.listen(container.config.port, () => {
  container.logger.info(
    { port: container.config.port, nodeEnv: container.config.nodeEnv },
    'SecureCred API listening',
  );
});

const shutdown = (signal) => {
  container.logger.info({ signal }, 'shutting down');
  server.close(async (err) => {
    if (err) {
      container.logger.error({ err }, 'error while closing HTTP server');
    }
    try {
      await container.close();
    } catch (closeErr) {
      container.logger.error({ err: closeErr }, 'error while closing pg pool');
    } finally {
      process.exit(err ? 1 : 0);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
