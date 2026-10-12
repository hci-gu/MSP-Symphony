const mareld = require('./src/app/features/mareld-shared/run-config.json');

const TARGETS_CONFIG = {
  remote: {
    host: 'https://myserver:8443'
  },
  local: {
    host: 'https://127.0.0.1:8443'
  }
};

const target =
  process.env.SYMPHONY_API_URL || TARGETS_CONFIG[process.env.PROXY_TARGET ?? 'remote'].host;
const PROXY_CONFIG = {
  [mareld.apiPath]: {
    target: process.env.MARELD_API_URL || mareld.defaultApiTarget,
    pathRewrite: { [`^${mareld.apiPath}`]: '' },
    changeOrigin: true,
    timeout: mareld.runTimeoutMs + mareld.proxyGraceMs,
    proxyTimeout: mareld.runTimeoutMs + mareld.proxyGraceMs
  },
  '/symphony-ws/service': {
    target,
    secure: false,
    logLevel: 'debug',
    changeOrigin: true
  },
  '/socket': {
    target,
    pathRewrite: { '^/socket': '/symphony-ws' },
    secure: false,
    ws: true
  }
};

module.exports = PROXY_CONFIG;
