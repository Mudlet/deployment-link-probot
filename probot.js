const appFn = require('./index')
const { Probot } = require('probot')

module.exports = new Probot({
  overrides: {
    // injected by vercel env vars
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
    secret: process.env.WEBHOOK_SECRET
  },
  load: appFn
})
