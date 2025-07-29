const { createNodeMiddleware, Probot } = require('probot');
const { probotApp } = require('../../index');
const getRawBody = require('raw-body');

const probot = new Probot({
  appId: Number(process.env.APP_ID ?? 0),
  privateKey: (process.env.PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  secret: process.env.WEBHOOK_SECRET ?? '',
});

const middleware = createNodeMiddleware(probotApp, { probot });

module.exports = async (req, res) => {
  // DEBUG: Signature troubleshooting
  try {
    const rawBody = await getRawBody(req); // You’ll need raw body, not parsed body
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex')}`;

    console.warn('Expected Signature:', expectedSignature);
    console.warn('Received Signature:', req.headers['x-hub-signature-256']);
  } catch (err) {
    console.warn('Signature debugging failed:', err.message);
  }
  // Let Probot handle the webhook
  return middleware(req, res);
};
