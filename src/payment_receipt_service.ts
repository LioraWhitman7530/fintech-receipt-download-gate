import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai_storage.js";
import { authorizeReceiptDownload, receiptRequestSchema } from "./signed_receipt_download.js";

const bucket = process.env.RECEIPT_BUCKET ?? "private-payment-receipts";
const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function start(): Promise<void> {
  await infrai.storage.bucket.create(bucket);

  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/receipt-downloads") {
      json(response, 404, { error: "route_not_found" });
      return;
    }

    try {
      const input = receiptRequestSchema.parse(await readJson(request));
      const outcome = await authorizeReceiptDownload(input);
      console.info(JSON.stringify(outcome.audit));
      json(response, outcome.status === "ready" ? 200 : outcome.status === "review" ? 202 : 404, outcome);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      if (error instanceof InfraiError) {
        const status = error.status >= 400 && error.status < 500 ? error.status : 502;
        json(response, status, { error: error.code, message: error.message });
        return;
      }
      json(response, 500, { error: "service_error" });
    }
  }).listen(port, () => console.log(`Receipt service listening on http://localhost:${port}`));
}

void start();
