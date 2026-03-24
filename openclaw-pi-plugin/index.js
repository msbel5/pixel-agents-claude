import { DASHBOARD_BASE_PATH } from './lib/constants.js';
import { createDashboardHttpHandler } from './lib/http.js';
import { registerPixelAgentsCli } from './lib/kiosk.js';
import { createDashboardState } from './lib/state.js';

export default {
  id: 'pixel-agents',
  name: 'Pixel Agents Dashboard',
  description:
    'Pixel Agents style live dashboard for OpenClaw, optimized for Raspberry Pi kiosk screens and tablet PWA mirroring.',
  register(api) {
    const state = createDashboardState({ api });
    const httpHandler = createDashboardHttpHandler({
      basePath: DASHBOARD_BASE_PATH,
      state,
      logger: api.logger,
    });

    api.registerHttpRoute({
      path: DASHBOARD_BASE_PATH,
      auth: 'plugin',
      match: 'prefix',
      handler: httpHandler,
    });

    api.registerCli(
      ({ program, config, logger }) => {
        registerPixelAgentsCli({
          api,
          program,
          config,
          logger,
        });
      },
      {
        commands: ['pixel-agents'],
      },
    );

    api.registerService({
      id: 'pixel-agents-dashboard',
      start: async (ctx) => {
        await state.start(ctx);
      },
      stop: async () => {
        await state.stop();
      },
    });
  },
};
