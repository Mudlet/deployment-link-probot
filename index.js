let application;
import _ from "lodash";
import axios from 'axios';

///////////////////////////////////////////////
// Utility functions for comments
///////////////////////////////////////////////
const createDeploymentComment = async (context, title) => {
  const body = getCommentTemplate(title);
  // GitHub's API handles comments to PRs as comments to issues, so we use the issue context here.
  const prComment = context.issue({ body: body });
  await context.octokit.rest.issues.createComment(prComment);
};

const getCommentTemplate = (title) =>
  "Hey there! Thanks for helping Mudlet improve. :star2:\n" + 
  "\n" +
  "## Test versions\n" +
  "\n" +
  "You can directly test the changes here:\n" +
  "- linux: (download pending, check back soon!)\n" +
  "- osx intel: (download pending, check back soon!)\n" +
  "- osx arm: (download pending, check back soon!)\n" +
  "- windows 64 bit: (download pending, check back soon!)\n" +
  "\n" +
  "No need to install anything - just unzip and run.\n" +
  "Let us know if it works well, and if it doesn't, please give details.\n" +
  (title === "Improve: New Crowdin updates"
    ? "\n" +
      "## Translation stats\n\n" +
      "calculation pending, check back soon!\n\n"
    : "");

const getDeploymentComment = async (
  repositoryOwner,
  repositoryName,
  prNumber,
  github
) => {
  application.log.info("retrieving comments...");
  const commentAnswer = await github.rest.issues.listComments({
    owner: repositoryOwner,
    repo: repositoryName,
    issue_number: prNumber,
  });
  return _.find(
    commentAnswer.data,
    (comment) => comment.user.login === "add-deployment-links[bot]"
  );
};

const updateDeploymentCommentBody = async (
  repoOwner,
  repoName,
  comment,
  github
) => {
  application.log.info("Setting new comment body to:");
  application.log.info(comment.body);
  await github.rest.issues.updateComment({
    owner: repoOwner,
    repo: repoName,
    comment_id: comment.id,
    body: comment.body,
  });
};

///////////////////////////////////////////////
// appveyor utility functions
///////////////////////////////////////////////
const getPrNumberFromAppveyor = async (
  repositoryOwner,
  repositoryName,
  buildId
) => {
  const response = await axios.get(
    `https://ci.appveyor.com/api/projects/${repositoryOwner}/${repositoryName.toLowerCase()}/builds/${buildId}`
  );
  const builds = response.data;
  return builds.build.pullRequestId;
};

///////////////////////////////////////////////
// testing link functions
///////////////////////////////////////////////
const translatePlatform = (platform) => {
  if (platform === "macos") {
    return "osx";
  }
  return platform;
};

const getMudletSnapshotLinksForPr = async (prNumber) => {
  const apiResponse = await axios.get(
    `https://make.mudlet.org/snapshots/json.php?prid=${prNumber}`
  );
  const allPrLinks = apiResponse.data.data;

  if (typeof allPrLinks !== "object") {
    // we probably got an error here, so return an empty array
    return [];
  }
  // let's go crazy with functional programming, shall we?
  const latestLinks = _.chain(allPrLinks)
    // we use a different encoding for macOS, so we need to change it
    .map((value) => {
      return { ...value, platform: translatePlatform(value.platform) };
    })
    // now categorize them by OS
    .reduce(
      (result, value) => {
        result[value.platform].push(value);
        return result;
      },
      { windows: [], linux: [], osx: [] }
    )
    // now sort each OS by the creation_time (descending)
    .mapValues((value) =>
      value.sort((first, second) => {
        if (first.creation_time === second.creation_time) {
          return 0;
        } else if (first.creation_time < second.creation_time) {
          return 1;
        } else {
          return -1;
        }
      })
    )
    // for windows, take the two latest links: windows-64 and windows-32
    // for osx, take the two latest links of x86_64 and arm64
    .mapValues((value, platform) => {
      if (platform === "windows") {
        return value
          .filter((val) => /windows-64|windows-32/.test(val.url))
          .slice(0, 2);
      }
      if (platform === "osx") {
        return value.filter((val) => /x86_64|arm64/.test(val.url)).slice(0, 2);
      }
      // for other platforms, take only the latest link
      return value[0] ? [value[0]] : [];
    })
    // remove undefined values
    .filter((value) => value !== undefined)
    .values()
    .flatten()
    .value();
  return latestLinks;
};

const updateCommentUrl = (os, link, commitid, comment) => {
  comment.body = comment.body.replace(
    new RegExp(`- ${os}: .+`),
    `- ${os}: ${link} (commit ${commitid})`
  );
};

const setDeploymentLinks = async (
  repositoryOwner,
  repositoryName,
  prNumber,
  github
) => {
  if (prNumber === undefined) {
    return;
  }

  application.log.info("Running for: " + prNumber);
  const links = await getMudletSnapshotLinksForPr(prNumber);
  const deploymentComment = await getDeploymentComment(
    repositoryOwner,
    repositoryName,
    prNumber,
    github
  );
  if (deploymentComment === undefined) {
    // shouldn't happen, but maybe there was a fluke?
    return;
  }
  for (const pair of links) {
    if (pair.platform === "windows") {
      pair.platform = "windows 64 bit";
    }
    if (pair.platform === "osx") {
      if (/x86_64/.test(pair.url)) {
        //TODO support for "legacy" PRs with only one osx platform entry. remove when these are rolled through
        updateCommentUrl(
          pair.platform,
          pair.url,
          pair.commitid,
          deploymentComment
        );
        pair.platform = "osx intel";
      } else if (/arm64/.test(pair.url)) {
        pair.platform = "osx arm";
      }
    }
    updateCommentUrl(pair.platform, pair.url, pair.commitid, deploymentComment);
  }
  application.log.info("New deployment body:");
  application.log.info(deploymentComment.body);
  updateDeploymentCommentBody(
    repositoryOwner,
    repositoryName,
    deploymentComment,
    github
  );
};

///////////////////////////////////////////////
// functions for creating the translation statistics
///////////////////////////////////////////////
const translationStatRegex =
  /^\[\d{2}:\d{2}:\d{2}\]\s*(?<star>\*?)\s*(?<language>\w{2}_\w{2})\s*(?<translated>\d+)\s*(?<untranslated>\d+)\s*\d+\s*\d+\s*\d+\s*(?<percentage>\d+)%$/gm;
const translationStatReplacementRegex = new RegExp(
  "## Translation stats[^#]+",
  "gm"
);

const getPassedAppveyorJobs = async (
  targetUrl,
  repositoryOwner,
  repositoryName
) => {
  const matches = targetUrl.match("/builds/(\\d+)");
  const buildId = matches[1];
  application.log.info("Build ID: " + buildId);
  const response = await axios.get(
    `https://ci.appveyor.com/api/projects/${repositoryOwner}/${repositoryName.toLowerCase()}/builds/${buildId}`
  );
  const builds = response.data;
  const passedJobs = _.filter(
    builds.build.jobs,
    (element) => element.status === "success"
  );
  return passedJobs;
};

const getAppveyorLog = async (job) => {
  const response = await axios.get(
    `https://ci.appveyor.com/api/buildjobs/${job.jobId}/log`
  );
  return response.data;
};

const getTranslationStatsFromAppveyor = async (githubStatusPayload) => {
  application.log.info("getting passed jobs");
  const passedJobs = await getPassedAppveyorJobs(
    githubStatusPayload.target_url,
    githubStatusPayload.repository.owner.login,
    githubStatusPayload.repository.name
  );

  if (passedJobs.length === 0) {
    return {};
  }

  const log = await getAppveyorLog(passedJobs[0]);

  let translationMatches;
  const translationStats = [];
  while ((translationMatches = translationStatRegex.exec(log)) !== null) {
    translationStats.push({
      language: translationMatches.groups.language,
      translated: translationMatches.groups.translated,
      untranslated: translationMatches.groups.untranslated,
      percentage: translationMatches.groups.percentage,
      hasStar: translationMatches.groups.star === "*",
    });
  }

  translationStats.sort(
    (item1, item2) => parseInt(item2.percentage) - parseInt(item1.percentage)
  );

  return translationStats;
};

const buildTranslationTable = (translationStats) => {
  let output = "## Translation stats\n\n";
  output += "|language|translated|untranslated|percentage done|\n";
  output += "|--------|----------|------------|---------------|\n";
  for (const stat of translationStats) {
    output += `|${stat.hasStar ? ":star:" : ""}${stat.language}|${
      stat.translated
    }|${stat.untranslated}|${stat.percentage}%|\n`;
  }
  output += "\n";
  return output;
};

const createTranslationStatistics = async (github, githubStatusPayload) => {
  if (githubStatusPayload.context.includes("pr")) {
    const prNumber = await getPrNumberFromAppveyor(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      githubStatusPayload.target_url.match("/builds/(\\d+)")[1]
    );
    const translationStats = await getTranslationStatsFromAppveyor(
      githubStatusPayload
    );

    if (translationStats.length === 0) {
      application.log.warn("No translation stats found, aborting");
      return;
    }
    const output = buildTranslationTable(translationStats);

    const comment = await getDeploymentComment(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      prNumber,
      github
    );

    if (!comment) {
      application.log.warn("Couldn't find our comment, aborting");
      return;
    }

    comment.body = comment.body.replace(
      translationStatReplacementRegex,
      output
    ); // on non-translation PRs, this doesn't replace anything as the block is not added
    updateDeploymentCommentBody(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      comment,
      github
    );
  }
};

///////////////////////////////////////////////
// functions for handling pingbacks from the snapshots service
///////////////////////////////////////////////

const newSnapshotMiddleware = async (request, response) => {
  if(request.method !== "POST") {
    return
  }
  const requestUrl = new URL(request.url, "http://localhost")
  if(requestUrl.pathname !== "/snapshots"){
    return
  }
  request.query = requestUrl.searchParams
  await newSnapshotHandler(request, response)
}

const newSnapshotHandler = async (request, response) => {
  application.log.debug("Checkpoint: starting handler");
  if (!validateRequest(request)) {
    application.log.debug("Checkpoint: parameters missing");
    response.statusCode = 400;
    response.statusMessage = "Bad Request: missing parameters";
    response.end();
    return;
  }

  const owner = request.query.get("owner");
  const repo = request.query.get("repo");

  application.log.debug("Checkpoint: getting auth");
  const appOctokit = await application.auth();
  application.log.debug("Checkpoint: getting installation");
  const installation = await getInstallation(appOctokit, owner, repo, response);

  if (installation === undefined) {
    application.log.debug("Checkpoint: no install found");
    response.statusCode = 500;
    response.statusMessage = "Internal Server Error: no installation found";
    response.end();
    return;
  }

  application.log.debug("Checkpoint: getting installation auth");
  const installationOctokit = await application.auth(installation.id);

  // read full request body
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });

  request.on("end", async () => {
    try {
      const parsedBody = JSON.parse(body);
      for (const prNumber of parsedBody) {
        application.log.debug("Checkpoint: setting links for " + prNumber);
        await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
      }

      application.log.debug("Checkpoint: done");

      response.statusCode = 204;
      response.end();
    } catch (exception) {
      application.log.fatal(exception);
      response.statusCode = 500;
      response.statusMessage = "Internal Server Error: exception occurred";
      response.end();
    }
  });
};

const validateRequest = (request) => {
  return request.query.get("owner") !== undefined && request.query.get("repo") !== undefined;
};

const getInstallation = async (octokit, owner, repo, response) => {
  try {
    return (await octokit.rest.apps.getRepoInstallation({ owner, repo })).data;
  } catch (exception) {
    if (exception.status === 404) {
      response.statusCode = 404;
      response.statusMessage = "Not Found: app not installed to given owner and repository";
      response.end();
    } else {
      application.log.fatal(exception);
      response.statusCode = 500;
      response.statusMessage = `Unknown response from GitHub API: ${exception.headers.status}`;
      response.end();
    }
    return undefined;
  }
};

///////////////////////////////////////////////
// entrypoint
///////////////////////////////////////////////
export const appFunction = (app, { addHandler }) => {
  application = app;
  // trigger to create a new deployment comment
  app.on("pull_request", async (context) => {
    if (context.payload.action !== "opened") {
      return;
    }
    await createDeploymentComment(context, context.payload.pull_request.title);
  });

  // trigger for appveyor builds. We pull the translation statistics from those and we use it as a trigger to scrape https://make.mudlet.org/snapshots
  app.on("status", async (context) => {
    if (
      !context.payload.context.includes("pr") &&
      !context.payload.context.includes("appveyor")
    ) {
      return;
    }
    await createTranslationStatistics(context.octokit, context.payload);
    await setDeploymentLinks(
      context.payload.repository.owner.login,
      context.payload.repository.name,
      await getPrNumberFromAppveyor(
        context.payload.repository.owner.login,
        context.payload.repository.name,
        context.payload.target_url.match("/builds/(\\d+)")[1]
      ),
      context.octokit
    );
  });

  app.on("issue_comment", async (context) => {
    if (context.payload.action !== "created") {
      return;
    }

    if (context.payload.comment.body === "/create links") {
      await createDeploymentComment(context, context.payload.issue.title);
    }

    if (
      context.payload.comment.body === "/refresh links" ||
      context.payload.comment.body === "/create links"
    ) {
      await setDeploymentLinks(
        context.payload.repository.owner.login,
        context.payload.repository.name,
        context.payload.issue.number,
        context.octokit
      );
      await context.octokit.rest.reactions.createForIssueComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        comment_id: context.payload.comment.id,
        content: "+1",
      });
    }
  });

  addHandler(newSnapshotMiddleware);
};
