const { Probot } = require('probot');

// GitHub App instance
const probot = new Probot({
  appId: Number(process.env.APP_ID),
  privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'),
  secret: process.env.WEBHOOK_SECRET
});

const validateRequest = (req) =>
  req.query.owner !== undefined && req.query.repo !== undefined;

const getInstallation = async (octokit, owner, repo, res) => {
  try {
    return (await octokit.apps.getRepoInstallation({ owner, repo })).data;
  } catch (err) {
    if (err.status === 404) {
      res.status(404).send('App not installed to given owner/repo');
    } else {
      res.status(500).send(`GitHub API error: ${err.message}`);
    }
    return undefined;
  }
};

// Import setDeploymentLinks from your main file or move it here
const { setDeploymentLinks } = require('../../index');

module.exports = async (req, res) => {
  if (!validateRequest(req)) {
    res.status(400).send('Missing parameters');
    return;
  }

  const { owner, repo } = req.query;
  let appOctokit;
  try {
    appOctokit = await probot.auth();
  } catch (err) {
    res.status(500).send(`GitHub API error: ${err.message}`);
    return undefined;
  }
  const installations = await appOctokit.request('GET /app/installations');
  console.log(installations.data);
  const installation = await getInstallation(appOctokit, owner, repo, res);
  if (!installation) return;

  const installationOctokit = await probot.auth(installation.id);

  for (const prNumber of req.body || []) {
    await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
  }

  res.status(204).send();
};
