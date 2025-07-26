const { createNodeMiddleware, Probot } = require('probot');
const { probotApp } = require('../../index');

const probot = new Probot({
  appId: Number(process.env.APP_ID),
  privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
  secret: process.env.WEBHOOK_SECRET,
});

const middleware = createNodeMiddleware(probotApp, { probot });

module.exports = async (req, res) => {
  // Let Probot handle the webhook
  return middleware(req, res);
};
