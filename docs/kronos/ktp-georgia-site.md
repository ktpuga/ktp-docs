---
sidebar_position: 1
---

# KTPGeorgia Deployment

## Overview

The documented host for `ktpgeorgia.com` is LXC 116 on Kronos. A self-hosted GitHub runner builds and deploys the Docker container when changes reach `main`.

The deployment workflow is `.github/workflows/deploy.yml`.

## Deployment Flow

1. Push or merge changes to `main`.
2. GitHub Actions starts the deployment workflow.
3. The self-hosted runner builds the image and replaces the running container.

Use this workflow for routine deployments so the deployed version can be traced to a GitHub run.

## Troubleshooting

### Changes pushed but not visible on production

Check the workflow run for the expected commit, the runner's status, build and deployment logs, and container health. If the workflow cannot access the repository, check the permissions for `admin@ugaktp.com`.

## Notes for Infrastructure Committee

Keep routine deployment changes in the workflow. Manual server-side pulls bypass the recorded deployment process and can leave the checkout out of sync.
