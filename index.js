let application
const Travis = require("travis-ci");
const _ = require("lodash")
const util = require("util")
const request = require("request-promise-native")

///////////////////////////////////////////////
// Appveyor stuff
///////////////////////////////////////////////

const getPassedAppveyorJobs = async (targetUrl, repositoryOwner, repositoryName) => {
  const matches = targetUrl.match("/builds/(\\d+)")
  const buildId = matches[1]
  application.log("Build ID: " + buildId)
  const response = await request(`https://ci.appveyor.com/api/projects/${repositoryOwner}/${repositoryName.toLowerCase()}/builds/${buildId}`);
  const builds = JSON.parse(response)
  const passedJobs = _.filter(builds.build.jobs, element => element.status === "success")
  return { passedJobs, prNumber: builds.build.pullRequestId }
}

const getAppveyorLog = async job => await request(`https://ci.appveyor.com/api/buildjobs/${job.jobId}/log`)

const getAppveyorOs = job => "windows"

///////////////////////////////////////////////
// Travis stuff
///////////////////////////////////////////////
const travis = new Travis({
    version: '2.0.0'
})

const getPassedTravisJobs = async (targetUrl, repositoryOwner, repositoryName) => {
  const matches = targetUrl.match("/builds/(\\d+)")
  const buildId = matches[1]
  application.log("Build ID: " + buildId)
  const getTravisBuilds = util.promisify(travis.builds(buildId).get)
  const builds = await getTravisBuilds()
  const interestingJobs = _.filter(builds.jobs, element => element.number === `${builds.build.number}.1` || element.number === `${builds.build.number}.3`)
  const passedJobs = _.filter(interestingJobs, element => element.state === "passed")
  return { passedJobs, prNumber: builds.build.pull_request_number }
}

const getTravisLog = async job => {
  const getTravisLogFromServer = util.promisify(travis.jobs(job.id).log.get)
  const logs = await getTravisLogFromServer()
  return logs.log && logs.log.body 
    ? logs.log.body
    : logs
}

const getTravisOs = job => job.config.os

/////////////////////////////////////////////////
// Github stuff
/////////////////////////////////////////////////

const getDeploymentComment = async (repositoryOwner, repositoryName, prNumber, github) => {
  application.log("retrieving comments...")
  const commentAnswer = await github.issues.listComments({
    owner: repositoryOwner,
    repo: repositoryName,
    number: prNumber
  })
  return _.filter(commentAnswer.data, comment => comment.user.login === "add-deployment-links[bot]")[0]
}

const updateCommentUrlFromLog = (os, log, comment) => {
  const matches = log.match(/^(?:\s*\[\d{2,}:\d{2}:\d{2}\] )?Deployed the output to (.+)$/m)
  if(!matches) {
    application.log("Couldn't find the deployment echo.")
    return false
  }
  const deployUrl = matches[1]
  application.log(`Deployed the output for ${os} to: ${deployUrl}`)
  comment.body = comment.body.replace(new RegExp(`- ${os}: .+`), `- ${os}: ${deployUrl}`)
  return true
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
// main function for setting the URLs
///////////////////////////////////////////////
const setDeployUrl = async (github, githubStatusPayload, getOs, getPassedJobs, getLog) => {
  application.log("status context: " + githubStatusPayload.context)
  if(githubStatusPayload.context.includes("pr")){
    const { passedJobs, prNumber } = await getPassedJobs(
      githubStatusPayload.target_url,
      githubStatusPayload.repository.owner.login,
      githubStatusPayload.repository.name
    )
    if(passedJobs.length > 0){
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
      for(let i = 0; i < passedJobs.length; i++) {
        const job = passedJobs[i]
        const log = await getLog(job)
        updateCommentUrlFromLog(getOs(job), log, comment)
      }
      updateDeploymentCommentBody(
        githubStatusPayload.repository.owner.login,
        githubStatusPayload.repository.name,
        comment,
        github
      )
    }
  }
}

///////////////////////////////////////////////
// main function for creating the comment
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
          (payload.pull_request.title === "New Crowdin translations"
          ? "\n" +
            "## Translation stats\n\n" +
            "calculation pending, check back soon!\n\n"
          : "")
  await github.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    number: payload.number,
    body: body
  })
}

///////////////////////////////////////////////
// functions for creating the translation statistics
///////////////////////////////////////////////
const translationStatRegex = /^(?<language>\w{2}_\w{2})\t(?<translated>\d+)\t(?<untranslated>\d+)\t\d+\t\d+\t\d+\t(?<percentage>\d+)$/gm
const translationStatReplacementRegex = new RegExp("## Translation stats[^#]+", "gm")

const getTranslationStatsFromTravis = async githubStatusPayload => {
  const matches = githubStatusPayload.target_url.match("/builds/(\\d+)")
  const buildId = matches[1]
  const getTravisBuilds = util.promisify(travis.builds(buildId).get)
  const builds = await getTravisBuilds()
  const job = _.filter(builds.jobs, element => element.number === `${builds.build.number}.3`)[0]
  const prNumber = builds.build.pull_request_number
  const log = await getTravisLog(job)
  let translationMatches
  const translationStats = {}
  while((translationMatches = translationStatRegex.exec(log)) !== null){
    translationStats[translationMatches.groups.language] = {
      translated: translationMatches.groups.translated,
      untranslated: translationMatches.groups.untranslated,
      percentage: translationMatches.groups.percentage,
    }
  }
  
  return { prNumber, translationStats}
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
    const { prNumber, translationStats } = await getTranslationStatsFromTravis(githubStatusPayload)
    
    if(Object.keys(translationStats).length === 0){
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
  app.on("status", async context => {
    if(context.payload.context.includes("travis-ci")){
      setTimeout(async () => {
        await setDeployUrl(context.github, context.payload, getTravisOs, getPassedTravisJobs, getTravisLog)
        await createTranslationStatistics(context.github, context.payload)
      }, 10000)
    }else if(context.payload.context.includes("appveyor")){
      setDeployUrl(context.github, context.payload, getAppveyorOs, getPassedAppveyorJobs, getAppveyorLog)
    }
  }) 
  app.on("pull_request", async context =>  createPrCommentForUs(context.github, context.payload))
}
