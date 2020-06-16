# Deployment Link Probot #

We deploy the binaries resulting from pull request to a temporary place to allow testers to have a look at the changes without having to build the code themselves. The link to these deployments is hidden away in the build logs and thus not very accessable.

This bot removes the need to go to the build looks for the links, but posts them to the associated pull requests. It creates a comment for this purpose and updates that comment every time a successfull build is reported via the commit status API.

We considered using the deployment link feature for this first, but deployments are associated with commits, which may live in forked repositories without access for the bot. Using the comment makes the links much easier to copy and paste to other mediums as well.

## Commands ##

The bot supports the following commands by leaving a comment in the PR with the given content:

`/refresh links`
> Forces a refresh of the links in the bot's comment. Useful if updates stalled for some reason or the bot crashed.

## Setting up your own instance ##

The bot needs to be set up according to [the probot documentation](https://probot.github.io/docs/deployment/).

The bot is currently not set up for easy customization of the comment or echo style in the build logs but the places should be easily identified in the source.
