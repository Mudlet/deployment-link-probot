const probot = require('../../probot');

module.exports = async (req, res) => {
  await probot.webhooks.middleware(req, res);
};
