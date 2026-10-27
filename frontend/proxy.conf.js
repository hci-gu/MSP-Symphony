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
