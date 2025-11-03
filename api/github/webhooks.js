import { createNodeMiddleware, createProbot } from "probot";

import {appFunction} from "../../index.js";
const probot = createProbot();

export default await createNodeMiddleware(appFunction, { probot, webhooksPath: '/api/github/webhooks' });