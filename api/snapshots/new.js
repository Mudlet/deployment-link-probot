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
  const appOctokit = await probot.auth(); // JWT
  const { data: installs } = await appOctokit.request('GET /app/installations');
// pick install
  const inst = installs.find(i => i.account.login === owner);
  if (!inst) return res.status(404).send('Not installed for owner');
  const installationOctokit = await probot.auth(inst.id);
  console.log(await installationOctokit.request('GET /installation/repositories'));
  for (const prNumber of req.body || []) {
    await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
  }

  res.status(204).send();
};
