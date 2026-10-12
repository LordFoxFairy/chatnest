import { lookup } from "node:dns/promises";
import { createServer, type IncomingHttpHeaders, request } from "node:http";
import { connect, type Socket } from "node:net";
import { isPublicAddress, publicBrowserUrl } from "./browser-policy";

async function destination(host: string) {
  const addresses = await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("Private network blocked");
  }
  return addresses[0].address;
}

// Resolve once and connect to the validated IP: prevents DNS-rebinding and also
// enforces policy on redirects, subresources and CONNECT (not just navigation).
export async function createBrowserProxy() {
  const sockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(publicBrowserUrl(req.url ?? ""));
      if (url.protocol !== "http:") {
        throw new Error("HTTPS requires CONNECT");
      }
      const headers: IncomingHttpHeaders = Object.fromEntries(
        Object.entries(req.headers).filter(
          ([key]) => !["proxy-authorization", "proxy-connection"].includes(key)
        )
      );
      headers.host = url.host;
      const upstream = request(
        {
          headers,
          hostname: await destination(url.hostname),
          method: req.method,
          path: url.pathname + url.search,
          port: 80,
          timeout: 15_000,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        }
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Public network access only");
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setTimeout(60_000, () => socket.destroy());
  });
  server.on("connect", async (req, socket, head) => {
    try {
      const url = new URL(publicBrowserUrl(`https://${req.url}`));
      if (url.port && url.port !== "443") {
        throw new Error("Blocked port");
      }
      const upstream = connect(
        443,
        await destination(url.hostname.replace(/^\[|\]$/g, ""))
      );
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.setTimeout(60_000, () => upstream.destroy());
      upstream.on("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) {
          upstream.write(head);
        }
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
    } catch {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proxy unavailable");
  }
  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    url: `http://127.0.0.1:${address.port}`,
  };
}
