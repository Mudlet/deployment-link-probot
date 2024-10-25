let application;
const _ = require("lodash");
const axios = require("axios");

///////////////////////////////////////////////
// Utility functions for comments
///////////////////////////////////////////////
const createDeploymentComment = async (context, title) => {
  const body = getCommentTemplate(title);
  // GitHub's API handles comments to PRs as comments to issues, so we use the issue context here.
  const prComment = context.issue({ body: body });
  await context.octokit.issues.createComment(prComment);
};

const getCommentTemplate = (title) =>
  "Hey there! Thanks for helping Mudlet improve. :star2:\n\n" +
  "## Test versions\n\n" +
  "You can directly test the changes here:\n" +
  "- linux: (download pending, check back soon!)\n" +
  "- osx intel: (download pending, check back soon!)\n" +
  "- osx arm: (download pending, check back soon!)\n" +
  "- windows 64 bit: (download pending, check back soon!)\n" +
  "- windows 32 bit: (download pending, check back soon!)\n\n" +
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
  application.log("retrieving comments...");
  const commentAnswer = await github.issues.listComments({
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
  application.log("Setting new comment body to:");
  application.log(comment.body);
  await github.issues.updateComment({
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

const updateCommentUrl = (os, link, comment) => {
  comment.body = comment.body.replace(
    new RegExp(`- ${os}: .+`),
    `- ${os}: ${link}`
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

  application.log("Running for: " + prNumber);
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
      if (/windows-64/.test(pair.url)) {
        pair.platform = "windows 64 bit";
      } else if (/windows-32/.test(pair.url)) {
        pair.platform = "windows 32 bit";
      }
    }
    if (pair.platform === "osx") {
      if (/x64_86/.test(pair.url)) {
        //TODO support for "legacy" PRs with only one osx platform entry. remove when these are rolled through
        updateCommentUrl(pair.platform, pair.url, deploymentComment);
        pair.platform = "osx intel";
      } else if (/arm64/.test(pair.url)) {
        pair.platform = "osx arm";
      }
    }
    updateCommentUrl(pair.platform, pair.url, deploymentComment);
  }
  application.log("New deployment body:");
  application.log(deploymentComment.body);
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
  application.log("Build ID: " + buildId);
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
  application.log("getting passed jobs");
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
      application.log("No translation stats found, aborting");
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
      application.log("Couldn't find our comment, aborting");
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

const newSnapshotHandler = async (request, response) => {
  if (!validateRequest(request)) {
    response.status(400).send("Bad Request: missing parameters");
    return;
  }

  const owner = request.query.owner;
  const repo = request.query.repo;

  const appOctokit = await application.auth();
  const installation = await getInstallation(appOctokit, owner, repo, response);
  if (installation === undefined) {
    return;
  }

  const installationOctokit = await application.auth(installation.id);

  for (const prNumber of request.body) {
    await setDeploymentLinks(owner, repo, prNumber, installationOctokit);
  }

  response.status(204).send();
};

const validateRequest = (request) => {
  return request.query.owner !== undefined && request.query.repo !== undefined;
};

const getInstallation = async (octokit, owner, repo, response) => {
  try {
    return (await octokit.apps.getRepoInstallation({ owner, repo })).data;
  } catch (exception) {
    if (exception.status === 404) {
      response
        .status(404)
        .send("app not installed to given owner and repository");
    } else {
      application.log(exception);
      response
        .status(500)
        .send(`Unknown response from GitHub API: ${exception.headers.status}`);
    }
    return undefined;
  }
};

///////////////////////////////////////////////
// entrypoint
///////////////////////////////////////////////
module.exports = (app, { getRouter }) => {
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
    }
  });

  const router = getRouter("/snapshots");

  router.use(require("express").json());

  router.post("/new", newSnapshotHandler);
};
