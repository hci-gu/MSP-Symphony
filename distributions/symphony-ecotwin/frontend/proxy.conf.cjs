const native = require('../../../frontend/proxy.conf.js');
// Compatibility for already-open clients that used the former discovery proxy.
// Execution remains exclusively on the authenticated, serialized backend routes.
module.exports = {
  ...native,
  '/mareld-api/v1/models': {
    ...native['/symphony-ws/service'],
    pathRewrite: { '^/mareld-api/v1/models': '/symphony-ws/service/extensions/ecotwin/models' }
  }
};
