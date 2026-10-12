import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only global-unicast IPv6, excluding the documentation range.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:db8:/i.test(address)
  );
}

export function publicBrowserUrl(input: string): string {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (!host.includes(".") && !isIP(host)) ||
    (isIP(host) && !isPublicAddress(host))
  ) {
    throw new Error(
      "浏览器仅允许无凭据的公网 HTTP(S) 地址 (public pages only)"
    );
  }
  return url.href;
}

export type BrowserMode = "agent" | "paused" | "manual";

export function sameOriginBrowserControl(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin) {
      return false;
    }
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      origin === `${parsed.protocol}//${request.headers.get("host")}`
    );
  } catch {
    return false;
  }
}

export class BrowserControl {
  mode: BrowserMode = "agent";
  private revision = 0;
  private readonly approvals = new Map<string, number>();
  issueApproval(callId: string, lease: number) {
    this.assertAgent(lease);
    if (this.approvals.has(callId)) {
      this.assertApproval(callId, lease);
      return;
    }
    if (this.approvals.size >= 200) {
      this.approvals.delete(this.approvals.keys().next().value as string);
    }
    this.approvals.set(callId, lease);
  }
  assertApproval(callId: string, lease: number) {
    this.assertAgent(lease);
    if (this.approvals.get(callId) !== lease) {
      throw new Error(
        "浏览器确认已因接管或会话重启失效，请重新发起操作 (control revoked)"
      );
    }
  }
  setMode(mode: BrowserMode) {
    this.mode = mode;
    this.revision += 1;
  }
  agentLease() {
    if (this.mode !== "agent") {
      throw new Error("浏览器已暂停或被接管 (control revoked)");
    }
    return this.revision;
  }
  assertAgent(lease: number) {
    if (this.mode !== "agent" || lease !== this.revision) {
      throw new Error("浏览器控制权已切换，请开始新一轮继续 (control revoked)");
    }
  }
}
