let application
const _ = require("lodash")
const request = require("request-promise-native")

///////////////////////////////////////////////
// Utility functions for comments
///////////////////////////////////////////////
const createPrCommentForUs = async (github, payload) => {
  if(payload.action !== "opened") {
    return
  }
  application.log("Creating new comment for our use.")
  const body = "Hey there! Thanks for helping Mudlet improve. :star2:\n\n" +
          "## Test versions\n\n" +
          "You can directly test the changes here:\n" +
          "- linux: (download pending, check back soon!)\n" +
          "- osx: (download pending, check back soon!)\n" +
          "- windows: (download pending, check back soon!)\n\n" +
          "No need to install anything - just unzip and run.\n" +
          "Let us know if it works well, and if it doesn't, please give details.\n" +
          (payload.pull_request.title === "New Crowdin updates"
          ? "\n" +
            "## Translation stats\n\n" +
            "calculation pending, check back soon!\n\n"
          : "")
  await github.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.number,
    body: body
  })
}

const getDeploymentComment = async (repositoryOwner, repositoryName, prNumber, github) => {
  application.log("retrieving comments...")
  const commentAnswer = await github.issues.listComments({
    owner: repositoryOwner,
    repo: repositoryName,
    issue_number: prNumber
  })
  return _.filter(commentAnswer.data, comment => comment.user.login === "add-deployment-links[bot]")[0]
}

const updateDeploymentCommentBody = async (repoOwner, repoName, comment, github) => {
  application.log("Setting new comment body to:")
  application.log(comment.body)
  await github.issues.updateComment({
    owner: repoOwner,
    repo: repoName,
    comment_id: comment.id,
    body: comment.body
  })
}

///////////////////////////////////////////////
// appveyor utility functions
///////////////////////////////////////////////
const getPrNumberFromAppveyor = async (repositoryOwner, repositoryName, buildId) => {
  const response = await request(`https://ci.appveyor.com/api/projects/${repositoryOwner}/${repositoryName.toLowerCase()}/builds/${buildId}`);
  const builds = JSON.parse(response)
  return builds.build.pullRequestId
}

///////////////////////////////////////////////
// testing link functions
///////////////////////////////////////////////
const translatePlatform = platform => {
  if(platform === "macos"){
    return "osx"
  }
  return platform
}

const getMudletSnapshotLinksForPr = async prNumber => {
  const apiResponse = await request.get(`https://make.mudlet.org/snapshots/json.php?prid=${prNumber}`)
  const allPrLinks = JSON.parse(apiResponse).data
  // let's go crazy with functional programming, shall we?
  const latestLinks = _.chain(allPrLinks)
    // we use a different encoding for macOS, so we need to change it
    .map(value => {
      return {...value, platform: translatePlatform(value.platform)}
    })
    // now categorize them by OS
    .reduce((result, value) => {
      result[value.platform].push(value)
      return result
    }, {windows:[], linux: [], osx:[]})
    // now sort each OS by the creation_time (descending)
    .mapValues(value => value.sort((first, second) => {
      if(first.creation_time === second.creation_time){
        return 0
      } else if (first.creation_time < second.creation_time) {
        return 1
      } else {
        return -1
      }
    }))
    // now take the latest link
    .mapValues(value => value[0])
    // flatten the object into an array
    .reduce((result, value) => {
      result.push(value)
      return result
    }, [])
    // remove undefined values
    .filter(value => value !== undefined)
    .value()
  return latestLinks
}

const updateCommentUrl = (os, link, comment) => {
  comment.body = comment.body.replace(new RegExp(`- ${os}: .+`), `- ${os}: ${link}`)
}

const setDeploymentLinks = async (repositoryOwner, repositoryName, prNumber, github) =>{
  application.log("Running for: " + prNumber)
  const links = await getMudletSnapshotLinksForPr(prNumber)
  const deploymentComment = await getDeploymentComment(repositoryOwner, repositoryName, prNumber, github)
  for(const pair of links){
    updateCommentUrl(pair.platform, pair.url, deploymentComment)
  }
  application.log("New deployment body:")
  application.log(deploymentComment.body)
  updateDeploymentCommentBody(repositoryOwner, repositoryName, deploymentComment, github)
}

///////////////////////////////////////////////
// functions for creating the translation statistics
///////////////////////////////////////////////
const translationStatRegex = /^\[\d{2}:\d{2}:\d{2}\]\s*\*?\s*(?<language>\w{2}_\w{2})\s*(?<translated>\d+)\s*(?<untranslated>\d+)\s*\d+\s*\d+\s*\d+\s*(?<percentage>\d+)%$/gm
const translationStatReplacementRegex = new RegExp("## Translation stats[^#]+", "gm")

const getPassedAppveyorJobs = async (targetUrl, repositoryOwner, repositoryName) => {
  const matches = targetUrl.match("/builds/(\\d+)")
  const buildId = matches[1]
  application.log("Build ID: " + buildId)
  const response = await request(`https://ci.appveyor.com/api/projects/${repositoryOwner}/${repositoryName.toLowerCase()}/builds/${buildId}`);
  const builds = JSON.parse(response)
  const passedJobs = _.filter(builds.build.jobs, element => element.status === "success")
  return passedJobs
}

const getAppveyorLog = async job => await request(`https://ci.appveyor.com/api/buildjobs/${job.jobId}/log`)

const getTranslationStatsFromAppveyor = async (githubStatusPayload) => {
  
  application.log("getting passed jobs")
  const passedJobs= await getPassedAppveyorJobs(
    githubStatusPayload.target_url,
    githubStatusPayload.repository.owner.login,
    githubStatusPayload.repository.name
  )
  
  if(passedJobs.length === 0){
    return {}
  }
  
  const log = await getAppveyorLog(passedJobs[0])
  
  let translationMatches
  const translationStats = {}
  while((translationMatches = translationStatRegex.exec(log)) !== null){
    translationStats[translationMatches.groups.language] = {
      translated: translationMatches.groups.translated,
      untranslated: translationMatches.groups.untranslated,
      percentage: translationMatches.groups.percentage,
    }
  }
  
  return translationStats
}

const buildTranslationTable = translationStats => {
  let output = "## Translation stats\n\n"
  output += "|language|translated|untranslated|percentage done|\n"
  output += "|--------|----------|------------|---------------|\n"
  for(const language of Object.keys(translationStats).sort()){
    output += `|${language}|${translationStats[language].translated}|${translationStats[language].untranslated}|${translationStats[language].percentage}|\n`
  }
  output += "\n"
  return output
}

const createTranslationStatistics = async (github, githubStatusPayload) => {
  if(githubStatusPayload.context.includes("pr")){
    const prNumber = await getPrNumberFromAppveyor(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      githubStatusPayload.target_url.match("/builds/(\\d+)")[1]
    )
    const translationStats = await getTranslationStatsFromAppveyor(githubStatusPayload)
    
    if(Object.keys(translationStats).length === 0){
      application.log("No translation stats found, aborting")
      return
    }
    const output = buildTranslationTable(translationStats)
    
    const comment = await getDeploymentComment(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      prNumber,
      github
    )
    
    if(!comment) {
      application.log("Couldn't find our comment, aborting")
      return
    }
    
    comment.body = comment.body.replace(translationStatReplacementRegex, output)  // on non-translation PRs, this doesn't replace anything as the block is not added
    updateDeploymentCommentBody(
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name,
      comment,
      github
    )
  }
}

///////////////////////////////////////////////
// entrypoint
///////////////////////////////////////////////
module.exports = app => {
  application = app
  // trigger to create a new deployment comment
  app.on("pull_request", async context =>  createPrCommentForUs(context.github, context.payload)) 
  
  // trigger for appveyor builds. We pull the translation statistics from those and we use it as a trigger to scrape https://make.mudlet.org/snapshots
  app.on("status", async context => {
    if(!context.payload.context.includes("pr") && !context.payload.context.includes("appveyor")){
      return
    }
    await createTranslationStatistics(context.github, context.payload)
    await setDeploymentLinks(
      context.payload.repository.owner.login,
      context.payload.repository.name,
      await getPrNumberFromAppveyor(
        context.payload.repository.owner.login,
        context.payload.repository.name,
        context.payload.target_url.match("/builds/(\\d+)")[1]
      ),
      context.github)
  })
  
  // trigger for Travis builds. We use it as a trigger to scrape https://make.mudlet.org/snapshots
  app.on("check_run", async context => {
    if(context.payload.check_run.name !== "Travis CI - Pull Request"){
      return
    }
    await setDeploymentLinks(
      context.payload.repository.owner.login,
      context.payload.repository.name,
      context.payload.check_run.output.text.match("https://github.com/Mudlet/Mudlet/pull/(\\d+)\\)")[1],
      context.github)
  })
  
  app.on("issue_comment", async context => {
    if(context.payload.action !== "created"){
      return
    }
    
    if(context.payload.comment.body !== "/refresh links"){
      return
    }
    
    await setDeploymentLinks(
      context.payload.repository.owner.login,
      context.payload.repository.name,
      context.payload.issue.number,
      context.github)
  })
}
