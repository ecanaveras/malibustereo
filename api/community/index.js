const { WebPubSubServiceClient } = require('@azure/web-pubsub');
const { createHandler } = require('../lib/community.cjs');
const { createStore } = require('../lib/azure-store.cjs');
let handler;

module.exports = async function (context, req) {
  try {
    const env = process.env;
    if (!env.COMMUNITY_PUBSUB_CONNECTION || !env.COMMUNITY_STORAGE_CONNECTION ||
        !env.COMMUNITY_ORIGINS || (env.COMMUNITY_SESSION_SECRET || '').length < 32) {
      context.res = { status: 503, headers: { 'Cache-Control': 'no-store' }, body: { error: 'El chat todavía no está disponible.' } };
      return;
    }
    handler ||= createHandler({
      store: createStore(env.COMMUNITY_STORAGE_CONNECTION, env.COMMUNITY_TABLE || 'MalibuPresence'),
      pubsub: new WebPubSubServiceClient(env.COMMUNITY_PUBSUB_CONNECTION, env.COMMUNITY_HUB || 'malibu'),
      secret: env.COMMUNITY_SESSION_SECRET,
      origins: env.COMMUNITY_ORIGINS.split(',').map(value => value.trim())
    });
    context.res = await handler(req);
  } catch (error) {
    // Never log request bodies, cookies, access URLs or Azure connection strings.
    context.log.warn('Community service unavailable', { statusCode: error.statusCode || 500 });
    context.res = { status: 503, headers: { 'Cache-Control': 'no-store' }, body: { error: 'No pudimos conectar el chat. Intenta de nuevo en unos segundos.' } };
  }
};
