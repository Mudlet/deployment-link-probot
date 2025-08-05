import { Octokit } from "@octokit/core";
import { createAppAuth } from "@octokit/auth-app";
import {
  setDeploymentLinks,
  getDeploymentComment,
  createDeploymentComment,
} from "../../index.js";

export const config = {
  runtime: "edge"
};

const validateRequest = (searchParams) =>
  searchParams.get("owner") !== null && searchParams.get("repo") !== null;

export default async function handler(req) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  if (!validateRequest(searchParams)) {
    return new Response("Missing parameters", { status: 400 });
  }

  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // ✅ Create App Octokit manually (no Probot)
  const auth = createAppAuth({
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY.replace(/\\n/g, "\n"),
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  });

  const appAuthentication = await auth({ type: "app" });
  const appOctokit = new Octokit({ auth: appAuthentication.token });

  let installationId;
  try {
    const result = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
      owner,
      repo,
    });
    installationId = result.data.id;
  } catch (err) {
    const status = err.status === 404 ? 404 : 500;
    const msg =
      err.status === 404
        ? "App not installed to given owner/repo"
        : `GitHub API error: ${err.message}`;
    return new Response(msg, { status });
  }

  const installationAuthentication = await auth({
    type: "installation",
    installationId,
  });

  const installationOctokit = new Octokit({
    auth: installationAuthentication.token,
  });

  let lastPRNumber = 0;

  for (const prNumber of body || []) {
    const existingComment = await getDeploymentComment(
      owner,
      repo,
      prNumber,
      installationOctokit
    );

    if (!existingComment) {
      await createDeploymentComment(
        {
          issue: ({ body }) => ({ owner, repo, issue_number: prNumber, body }),
          octokit: installationOctokit,
        },
        "Automated deployment links"
      );
    } else {
      await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
    }

    lastPRNumber = prNumber;
  }

  const headers = new Headers();
  headers.set("X-Last-PR-Number", lastPRNumber.toString());
  return new Response(null, { status: 204, headers });
}
