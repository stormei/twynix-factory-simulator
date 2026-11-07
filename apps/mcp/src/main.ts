import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createSimulatorMcp } from "./server";

// Stdout is exclusively the MCP JSON-RPC stream. Backend logs stay in the backend process.
serveStdio(() =>
  createSimulatorMcp({
    backendUrl: process.env["TWYNIX_BACKEND_URL"] ?? "http://127.0.0.1:3000",
    token: process.env["API_TOKEN"],
  }),
);
