# FAQ assistant

The question-mark icon beside the header theme toggle opens the assistant and searchable FAQs. On mobile it floats above the messages button.
The shared header makes it available across signed-in portals.

## NVIDIA connection

For local XAMPP, add the following settings to `frontend/.env`. PHP reads these two settings directly from that file on each request. Keep the key in `NVIDIA_API_KEY`, without a `REACT_APP_` prefix, so it is not embedded in the browser bundle. The `.env` file is ignored by Git, denied over HTTP, and excluded from Docker builds.

```text
NVIDIA_API_KEY=<your private NVIDIA API key>
HRIS_FAQ_AI_MODEL=deepseek-ai/deepseek-v4.1-flash
```

Configuration precedence is backend environment variables, then `frontend/.env`, then the optional `api/ai-config.local.php` fallback. Only the two settings above are read from `.env`; PHP does not load the frontend's other settings. Saving the file takes effect on the next PHP request, without restarting React.

For hosted deployments, set these backend environment variables:

```text
NVIDIA_API_KEY=<your private NVIDIA API key>
HRIS_FAQ_AI_MODEL=deepseek-ai/deepseek-v4.1-flash
```

The model defaults to the name above. Requests use the fixed NVIDIA endpoint `https://integrate.api.nvidia.com/v1/chat/completions` with TLS verification and a 75-second provider timeout (90 seconds in the client). PHP cURL must be enabled. Model/API reference: https://build.nvidia.com/deepseek-ai/deepseek-v4.1-flash

DeepSeek V4 requests disable extended thinking through `chat_template_kwargs.thinking` because this assistant explains documented workflows. Relevant screen facts are selected per question to keep the prompt focused while the entire module catalog remains available.

If the key is missing, rejected, rate limited, or the service is unavailable, the assistant returns a matching built-in FAQ and labels it as a system FAQ answer. General questions without a match are referred to HR/system administration.

## Maintaining answers

The assistant combines the quick answers in `data/faq-knowledge.json` with the complete generated catalog in `data/system-guide.json`. The system guide covers the primary workspaces, all settings screens, and all nine role portals. It includes reviewed workflow explanations plus source-derived screen sections, fields, actions, options, validation messages, navigation paths and source fingerprints.

Update the reviewed workflow descriptions in `frontend/scripts/faq-topics.cjs` when behavior changes. Run `npm run faq:build` from `frontend/` to regenerate the catalog. It also runs automatically before `npm start` and `npm run build`. Run `npm run faq:check` to verify that the generated guide matches current source. The generator fails if a settings screen or primary module workspace lacks documentation coverage.

For each question, retrieval ranks the entire guide library using the question, prior user questions, field names and error messages. The model gets the complete module index, general role/permission guidance, the most relevant detailed guides, and sanitized signed-in role/action/current-page context. No fixed list of FAQ wording is required. The response includes related guide references; the browser supports category filtering and searches the generated fields/messages too.

The generator reads only explicitly listed source files/directories and never reads environment files, local credentials, database dumps, backups, uploads or employee records. Deployment only needs the generated JSON; it does not need the frontend source tree to answer questions. The guide documents implemented system behavior and does not replace the office's HR policy database.

The endpoint requires a signed-in session and the app's CSRF protection. It accepts only bounded text history, limits AI requests per session, and releases the PHP session before the external request. It makes no employee/payroll-record queries. Context is reduced to the base role, whitelisted permission actions and a known navigation label; the complete session user, names, emails, employee IDs and raw page URL are not sent. Questions and upstream response bodies are not logged by the assistant.

## Recent chats

The History button lists the ten most recent completed conversations with a title and date. Users can reopen a chat, continue its conversation, or delete it. The plus button starts a new chat and keeps earlier conversations in History. Empty chats and failed questions are not saved. The active conversation is restored after reloading.

History uses browser localStorage, with a separate `hris_faq_history:v1:<userId>` key for each signed-in account. No database tables or history endpoints are used. Switching accounts resets the assistant and loads only that account's history. Saved messages include the answer source, notice and related guide references; only the latest ten messages from the active conversation are sent as follow-up context.

History remains on this browser and does not sync across devices. Deleting a chat removes it from that account's saved list; clearing the site's browser storage removes local history. If browser storage is unavailable or full, chatting continues in memory and the interface explains that recent changes may not survive a reload.

## Checks

From `frontend/`:

```text
npm run faq:build
npm run faq:check
```
