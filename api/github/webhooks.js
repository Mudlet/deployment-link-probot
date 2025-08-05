const { createNodeMiddleware, Probot } = require('probot')
const { probotApp } = require('../../index')

const probot = new Probot({
  appId: Number(process.env.APP_ID ?? 0),
  privateKey: (process.env.PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  secret: process.env.WEBHOOK_SECRET ?? ''
})

module.exports = createNodeMiddleware(probotApp, {
  probot,
  webhooksPath: '/api/github/webhooks'
})
