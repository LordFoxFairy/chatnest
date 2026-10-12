import assert from "node:assert/strict";
import test from "node:test";

const implementation = import("../../lib/agent/browser-policy").catch(
  () => null
);

test("streamed browser arguments do not consume the later approval auto-open event", async () => {
  const activity = await import("../../lib/agent/workspace-events").catch(
    () => null
  );
  assert.ok(activity, "browser workspace event handling is missing");
  const message = (state: string) => [
    {
      parts: [
        {
          state,
          toolCallId: "open-1",
          toolName: "browser__browser_navigate",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    },
  ];
  assert.deepEqual(
    activity.browserWorkspaceEvents(message("input-streaming"), true),
    []
  );
  assert.deepEqual(
    activity.browserWorkspaceEvents(message("approval-requested"), true),
    ["open-1"]
  );
  assert.deepEqual(
    activity.browserWorkspaceEvents(message("output-available"), false),
    []
  );
  assert.deepEqual(
    activity.browserWorkspaceEvents(message("output-available"), true),
    ["open-1"]
  );
  assert.deepEqual(
    activity.browserWorkspaceEvents(
      [
        ...message("output-available"),
        { parts: [{ type: "text" }], role: "user" },
      ],
      true
    ),
    [],
    "an unrelated new message must not reopen a historical browser result"
  );
});

test("browser control compares Origin against the received Host, not Next's normalized localhost URL", async () => {
  const policy = await implementation;
  assert.ok(
    policy?.sameOriginBrowserControl,
    "same-origin browser controls are missing"
  );
  const request = (origin: string) =>
    new Request("http://localhost:3000/api/browser", {
      headers: { host: "127.0.0.1:3000", origin },
    });
  assert.equal(
    policy.sameOriginBrowserControl(request("http://127.0.0.1:3000")),
    true
  );
  assert.equal(
    policy.sameOriginBrowserControl(request("https://evil.example")),
    false
  );
  assert.equal(policy.sameOriginBrowserControl(request("null")), false);
});

test("browser network policy accepts public pages and blocks local/file/credential destinations", async () => {
  const policy = await implementation;
  assert.ok(policy, "browser policy has not been implemented");
  assert.equal(
    policy.publicBrowserUrl("https://example.com/a"),
    "https://example.com/a"
  );
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost",
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "https://user:password@example.com",
    "https://example.com:9443",
  ]) {
    assert.throws(() => policy.publicBrowserUrl(url), /public|公网/);
  }
  for (const ip of [
    "10.0.0.1",
    "172.20.0.1",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.1.1",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "0.0.0.0",
  ]) {
    assert.equal(policy.isPublicAddress(ip), false, ip);
  }
  assert.equal(policy.isPublicAddress("93.184.216.34"), true);
  assert.equal(policy.isPublicAddress("2606:4700:4700::1111"), true);
});

test("taking browser control invalidates earlier agent leases, including after handing back", async () => {
  const policy = await implementation;
  assert.ok(policy, "browser control has not been implemented");
  const control = new policy.BrowserControl();
  const lease = control.agentLease();
  control.issueApproval("old-confirmation", lease);
  control.assertAgent(lease);
  control.setMode("manual");
  assert.throws(() => control.assertAgent(lease), /control|接管/);
  control.setMode("agent");
  assert.throws(() => control.assertAgent(lease), /control|接管/);
  control.assertAgent(control.agentLease());
  assert.throws(
    () => control.assertApproval("old-confirmation", control.agentLease()),
    /control/
  );
  control.issueApproval("new-confirmation", control.agentLease());
  control.assertApproval("new-confirmation", control.agentLease());
  control.setMode("paused");
  assert.throws(() => control.agentLease(), /control|暂停/);
});
