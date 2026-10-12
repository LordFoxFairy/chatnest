# Task and search experience

Goal: Verify the actual model/skill/search chain and make starting a goal-based investigation comfortable in the existing Vercel chat.

Scope: Add the existing keyless Exa search/fetch MCP alongside optional Tavily. Adapt its documented result headers to bounded source metadata. Preserve raw tool output, approval rules and failures. Give the existing skill display metadata without changing its investigative method. Add a small task dialog that starts a new normal conversation from a goal, optional materials and method; no separate scheduler or fake background execution.

UI: Minimal desktop-chat style. Sidebar and composer task entry, human-readable method descriptions and tool action labels, technical output collapsed behind details. Existing conversation/history/browser workspace remain the execution surface.

- [x] Write failing task, skill-metadata and provider-source tests.
- [x] Integrate Exa MCP and source adaptation; verify real search and fetch.
- [x] Add task entry and isolate new task submission from the previous chat.
- [x] Make skill and tool progress readable from actual tool states.
- [x] Verify UI regressions, real model + skill + search + source persistence, build and targeted review.

Evidence: 25 relevant unit/SDK checks, TypeScript, 14-file Biome and production build passed. Actual gpt-5.6-luna task used loadSkill, Exa search and Exa fetch successfully, saved and reloaded all message parts, displayed returned sources and produced no page errors. Task UI fixtures cover separate chat URLs, reload without rerun, interrupting an old stream and mobile entry. Tool/approval/source, missing-key desktop, workspace and local custom-model integration regressions passed. Scoped review found and fixed task URL persistence and header-shaped page-body source contamination. Desktop/mobile dialog and actual task screenshot inspected. Private configuration and review artifacts remain ignored; production trace excludes them.

Limits: Exa keyless access is rate-limited. A task is a foreground conversation, not a durable background job. Investigation accuracy is not established by connection tests. No external complaints, publication or third-party messages.
