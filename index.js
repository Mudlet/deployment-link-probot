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
    application.log(log)
    return false
  }
  const deployUrl = matches[1]
  application.log(`Deployed the output for ${os} to: ${deployUrl}`)
  comment.body = comment.body.replace(new RegExp(`- ${os}: .+?`), `- ${os}: ${deployUrl}`)
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
  const commentAnswer = await github.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    number: payload.number,
    body: "Hey there! Thanks for helping Mudlet improve. :star2:\n\n" +
          "You can directly test the changes here:\n" +
          "- linux: (link pending, check back soon!)\n" +
          "- osx: (link pending, check back soon!)\n" +
          "- windows: (link pending, check back soon!)\n\n" +
          "No need to install anything - just unzip and run.\n" +
          "Let us know if it works well, and if it doesn't, please give details."
  })
}

///////////////////////////////////////////////
// entrypoint
///////////////////////////////////////////////
module.exports = app => {
  application = app
  app.on("status", async context => {
    if(context.payload.context.includes("travis-ci")){
      setDeployUrl(context.github, context.payload, getTravisOs, getPassedTravisJobs, getTravisLog)
    }else if(context.payload.context.includes("appveyor")){
      setDeployUrl(context.github, context.payload, getAppveyorOs, getPassedAppveyorJobs, getAppveyorLog)
    }
  }) 
  app.on("pull_request", async context =>  createPrCommentForUs(context.github, context.payload))
}
