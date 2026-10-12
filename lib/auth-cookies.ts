/** Match Auth.js's URL-based cookie policy in dev, local production and HTTPS deployments. */
export function usesSecureAuthCookies(
  request: Request,
  env: Record<string, string | undefined> = process.env
) {
  const configuredUrl = env.AUTH_URL ?? env.NEXTAUTH_URL;
  if (configuredUrl) {
    return new URL(configuredUrl).protocol === "https:";
  }
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.replace(":", "");
  return protocol === "https";
}
