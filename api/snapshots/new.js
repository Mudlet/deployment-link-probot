const { Probot } = require('probot')

// GitHub App instance
const probot = new Probot({
  appId: Number(process.env.APP_ID ?? 0),
  privateKey: (process.env.PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  secret: process.env.WEBHOOK_SECRET ?? ''
})

const validateRequest = (req) =>
  req.query?.owner !== undefined && req.query?.repo !== undefined

const getInstallation = async (octokit, owner, repo, res) => {
  try {
    return (await octokit.apps.getRepoInstallation({ owner, repo })).data
  } catch (err) {
    if (err.status === 404) {
      res.status(404).send('getInstallation: App not installed to given owner/repo')
    } else {
      res.status(500).send(`getInstallation: GitHub API error: ${err.message}`)
    }
    return undefined
  }
}

// Import setDeploymentLinks from your main file or move it here
const {
  setDeploymentLinks,
  getDeploymentComment,
  createDeploymentComment
} = require('../../index')

module.exports = async (req, res) => {
  if (!validateRequest(req)) {
    res.status(400).send('Missing parameters')
    return
  }

  const { owner, repo } = req.query

  const appOctokit = await probot.auth()
  const installation = await getInstallation(appOctokit, owner, repo, res)
  if (!installation) return

  const installationOctokit = await probot.auth(installation.id)
  let lastPRNumber = 0
  for (const prNumber of req.body || []) {
    const existingComment = await getDeploymentComment(
      owner,
      repo,
      prNumber,
      installationOctokit
    )

    if (!existingComment) {
      // Create a new comment using the app logic
      await createDeploymentComment(
        {
          issue: ({ body }) => ({ owner, repo, issue_number: prNumber, body }),
          octokit: installationOctokit
        },
        'Automated deployment links' // You can adjust title if needed
      )
    } else {
      await setDeploymentLinks(owner, repo, prNumber, installationOctokit)
    }
    lastPRNumber = prNumber
  }
  res.setHeader('X-Last-PR-Number', lastPRNumber.toString())
  res.status(204).send()
}
