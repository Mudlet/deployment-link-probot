let application
const _ = require('lodash')
const axios = require('axios')

///////////////////////////////////////////////
// Utility functions for comments
///////////////////////////////////////////////
const createDeploymentComment = async (context, title) => {
  const body = getCommentTemplate(title)
  // GitHub's API handles comments to PRs as comments to issues, so we use the issue context here.
  const prComment = context.issue({ body: body })
  await context.octokit.issues.createComment(prComment)
}

const getCommentTemplate = (title) =>
  'Hey there! Thanks for helping Mudlet improve. :star2:\n\n' +
  '## Test versions\n\n' +
  'You can directly test the changes here:\n' +
  '- linux: (download pending, check back soon!)\n' +
  '- osx intel: (download pending, check back soon!)\n' +
  '- osx arm: (download pending, check back soon!)\n' +
  '- windows 64 bit: (download pending, check back soon!)\n' +
  'No need to install anything - just unzip and run.\n' +
  'Let us know if it works well, and if it doesn\'t, please give details.\n' +
  (title === 'Improve: New Crowdin updates'
    ? '\n' +
    '## Translation stats\n\n' +
    'calculation pending, check back soon!\n\n'
    : '')

const getDeploymentComment = async (
  repositoryOwner,
  repositoryName,
  prNumber,
  github
) => {
  application.log('retrieving comments...')
  const commentAnswer = await github.issues.listComments({
    owner: repositoryOwner,
    repo: repositoryName,
    issue_number: prNumber,
  })
  return _.find(
    commentAnswer.data,
    (comment) => comment.user.login === 'add-deployment-links[bot]'
  )
}

const updateDeploymentCommentBody = async (
  repoOwner,
  repoName,
  comment,
  github
) => {
  application.log('Setting new comment body to:')
  application.log(comment.body)
  await github.issues.updateComment({
    owner: repoOwner,
    repo: repoName,
    comment_id: comment.id,
    body: comment.body,
  })
}

///////////////////////////////////////////////
// testing link functions
///////////////////////////////////////////////
const translatePlatform = (platform) => {
  if (platform === 'macos') {
    return 'osx'
  }
  return platform
}

const getMudletSnapshotLinksForPr = async (prNumber) => {
  const apiResponse = await axios.get(
    `https://make.mudlet.org/snapshots/json.php?prid=${prNumber}`
  )
  const allPrLinks = apiResponse.data.data

  if (typeof allPrLinks !== 'object') {
    // we probably got an error here, so return an empty array
    return []
  }
  // let's go crazy with functional programming, shall we?
  const latestLinks = _.chain(allPrLinks)
    // we use a different encoding for macOS, so we need to change it
    .map((value) => {
      return { ...value, platform: translatePlatform(value.platform) }
    })
    // now categorize them by OS
    .reduce(
      (result, value) => {
        result[value.platform].push(value)
        return result
      },
      { windows: [], linux: [], osx: [] }
    )
    // now sort each OS by the creation_time (descending)
    .mapValues((value) =>
      value.sort((first, second) => {
        if (first.creation_time === second.creation_time) {
          return 0
        } else if (first.creation_time < second.creation_time) {
          return 1
        } else {
          return -1
        }
      })
    )
    // for windows, take the two latest links: windows-64 and windows-32
    // for osx, take the two latest links of x86_64 and arm64
    .mapValues((value, platform) => {
      if (platform === 'windows') {
        return value
          .filter((val) => /windows-64|windows-32/.test(val.url))
          .slice(0, 2)
      }
      if (platform === 'osx') {
        return value.filter((val) => /x86_64|arm64/.test(val.url)).slice(0, 2)
      }
      // for other platforms, take only the latest link
      return value[0] ? [value[0]] : []
    })
    // remove undefined values
    .filter((value) => value !== undefined)
    .values()
    .flatten()
    .value()
  return latestLinks
}

const updateCommentUrl = (os, link, commitid, comment) => {
  comment.body = comment.body.replace(
    new RegExp(`- ${os}: .+`),
    `- ${os}: ${link} (commit ${commitid})`
  )
}

const setDeploymentLinks = async (
  repositoryOwner,
  repositoryName,
  prNumber,
  github
) => {
  if (prNumber === undefined) {
    return
  }

  application.log('Running for: ' + prNumber)
  const links = await getMudletSnapshotLinksForPr(prNumber)
  const deploymentComment = await getDeploymentComment(
    repositoryOwner,
    repositoryName,
    prNumber,
    github
  )
  if (deploymentComment === undefined) {
    // shouldn't happen, but maybe there was a fluke?
    return
  }
  for (const pair of links) {
    if (pair.platform === 'windows') {
      pair.platform = 'windows 64 bit'
    }
    if (pair.platform === 'osx') {
      if (/x86_64/.test(pair.url)) {
        //TODO support for "legacy" PRs with only one osx platform entry. remove when these are rolled through
        updateCommentUrl(
          pair.platform,
          pair.url,
          pair.commitid,
          deploymentComment
        )
        pair.platform = 'osx intel'
      } else if (/arm64/.test(pair.url)) {
        pair.platform = 'osx arm'
      }
    }
    updateCommentUrl(pair.platform, pair.url, pair.commitid, deploymentComment)
  }
  application.log('New deployment body:')
  application.log(deploymentComment.body)
  updateDeploymentCommentBody(
    repositoryOwner,
    repositoryName,
    deploymentComment,
    github
  )
}

///////////////////////////////////////////////
// entrypoint
///////////////////////////////////////////////
module.exports = {
  probotApp: (app) => {
    application = app
    // trigger to create a new deployment comment
    app.on('pull_request', async (context) => {
      if (context.payload.action !== 'opened') {
        return
      }
      await createDeploymentComment(context, context.payload.pull_request.title)
    })

    app.on('issue_comment', async (context) => {
      if (context.payload.action !== 'created') {
        return
      }

      if (context.payload.comment.body === '/create links') {
        await createDeploymentComment(context, context.payload.issue.title)
      }

      if (
        context.payload.comment.body === '/refresh links' ||
        context.payload.comment.body === '/create links'
      ) {
        await setDeploymentLinks(
          context.payload.repository.owner.login,
          context.payload.repository.name,
          context.payload.issue.number,
          context.octokit
        )
        await context.octokit.reactions.createForIssueComment({
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
          comment_id: context.payload.comment.id,
          content: '+1',
        })
      }
    })
  },
  setDeploymentLinks,
  getDeploymentComment
}
