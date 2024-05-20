# Deployment Link Probot #

We deploy the binaries resulting from pull request to a temporary place to allow testers to have a look at the changes without having to build the code themselves. The link to these deployments is hidden away in the build logs and thus not very accessable.

This bot removes the need to go to the build looks for the links, and posts them to the associated pull requests. It creates a comment for this purpose and updates that comment every time a successfull build is reported via the commit status API.

We considered using the deployment link feature for this first, but deployments are associated with commits, which may live in forked repositories without access for the bot. Using the comment makes the links much easier to copy and paste to other mediums as well.

## Commands ##

The bot supports the following commands by leaving a comment in the PR with the given content:

`/create links`
> Creates the bot's comment with the deployment links. Useful if the bot crashed or was unable to create the link comment before.

`/refresh links`
> Forces a refresh of the links in the bot's comment. Useful if updates stalled for some reason or the bot crashed.

## Non-Github Endpoints ##

The bot supports the following endpoints that are not triggered by GitHub.

### `POST /snapshots/new?owner={owner}&repo={repo}` ###

Similar to the `/refresh links` command, this forces a refresh of the links. The endpoint has the following parameters:
- `owner`: The owner of the repository to update the deployment links
- `repo`: The repository to update the deployment links
- body of the POST: a JSON-array of PR numbers in the given repository to refresh the deployment links for.

Example:
```
POST /snapshots/new?owner=mudlet&repo=mudlet HTTP/1.1
Content-Length: 12
Content-Type: application/json
Host: mudlet-deployment-link-probot.glitch.me
[4571, 4477]
```

## Setting up your own instance ##

The bot needs to be set up according to [the probot documentation](https://probot.github.io/docs/deployment/).

The bot is currently not set up for easy customization of the comment or echo style in the build logs but the places should be easily identified in the source.

## Deployment

The running instance of the bot is deployed on [glitch.com](glitch.com). Contact @keneanung or @vadi2 for access.
