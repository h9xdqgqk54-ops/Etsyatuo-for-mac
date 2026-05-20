import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "../src/services/app_server.js";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handle(req, res);
}
