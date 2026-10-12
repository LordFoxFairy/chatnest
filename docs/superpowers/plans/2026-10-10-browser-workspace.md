# Browser workspace implementation

Goal: Complete the already approved conversation / chat / workspace design, with an actual shared browser session for the agent and human.

Architecture: Keep the official Vercel chat and AI SDK. Reuse Microsoft Playwright MCP through an in-memory MCP connection. Each authenticated owner/chat receives an isolated Chromium context, public-network-only proxy, bounded lifetime, and explicit control state. The right workspace embeds the existing document/source components alongside a live screenshot browser viewer; human input uses the same MCP connection as agent tools.

Tech stack: Next.js, React, AI SDK, Playwright MCP, Chromium.

Constraints: Preserve existing edits. No native OS desktop control, no user's Chrome profile, no arbitrary MCP/evaluate/file tools, no model-key fabrication. A screenshot viewer is interactive browser control, not a video desktop stream. Local long-lived Node runtime only; multi-worker/cloud deployment needs a dedicated browser worker.

- [x] Write and observe failing control/URL and workspace interaction tests.
- [x] Implement public egress restrictions and per-chat browser ownership/locking/expiry; verify against real Chromium and MCP.
- [x] Add authenticated state/frame/control routes and attach the allowed MCP tools to the current agent run. Mutating tools require approval; takeover revokes active/queued agent control.
- [x] Build a collapsible, resizable right workspace with browser/document/sources tabs, fullscreen and mobile behavior. Preserve tab state.
- [x] Verify real navigation, input, pause/takeover/resume, chat isolation, unsafe URL rejection, existing document and chat regressions, typecheck and build.
- [x] Review changes and report verified capabilities and missing model credentials honestly.

Result: 24 unit/integration checks, one PostgreSQL check, and eight UI suites passed this round. Final production build and browser/workspace/desktop/regeneration rechecks passed. Review fixes cover approval revalidation after takeover, eviction or browser restart, and streamed versus historical workspace events. The local production server is running on port 3000. Model-driven end-to-end investigation remains unverified because no model key is configured.
