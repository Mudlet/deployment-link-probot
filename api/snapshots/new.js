const { Probot } = require('probot');
const { setDeploymentLinks, getDeploymentComment, createDeploymentComment } = require('../../index');

const probot = new Probot({
  appId: Number(process.env.APP_ID ?? 0),
  privateKey: (process.env.PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  secret: process.env.WEBHOOK_SECRET ?? ''
});

const validateRequest = (searchParams) =>
  searchParams.get('owner') !== null && searchParams.get('repo') !== null;

export const config = {
  runtime: 'edge' // Required for Edge functions
};

export default async function handler(req) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  if (!validateRequest(searchParams)) {
    return new Response('Missing parameters', { status: 400 });
  }

  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');

  let body;
  try {
    body = await req.json(); // req is a Fetch API Request
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  let installation;
  try {
    const appOctokit = await probot.auth();
    const result = await appOctokit.apps.getRepoInstallation({ owner, repo });
    installation = result.data;
  } catch (err) {
    const status = err.status === 404 ? 404 : 500;
    const msg = err.status === 404
      ? 'getInstallation: App not installed to given owner/repo'
      : `getInstallation: GitHub API error: ${err.message}`;
    return new Response(msg, { status });
  }

  const installationOctokit = await probot.auth(installation.id);
  let lastPRNumber = 0;

  for (const prNumber of body || []) {
    const existingComment = await getDeploymentComment(owner, repo, prNumber, installationOctokit);

    if (!existingComment) {
      await createDeploymentComment(
        {
          issue: ({ body }) => ({ owner, repo, issue_number: prNumber, body }),
          octokit: installationOctokit
        },
        'Automated deployment links'
      );
    } else {
      await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
    }

    lastPRNumber = prNumber;
  }

  const headers = new Headers();
  headers.set('X-Last-PR-Number', lastPRNumber.toString());
  return new Response(null, { status: 204, headers });
}
