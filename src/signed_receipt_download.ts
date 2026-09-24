import { z } from "zod";
import { infrai } from "./infrai_storage.js";

export const receiptRequestSchema = z.object({
  paymentId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  accountId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  event: z.enum(["payment_settled", "payment_pending", "payment_reversed"]),
  risk: z.enum(["low", "medium", "high"]),
});

export type ReceiptRequest = z.infer<typeof receiptRequestSchema>;

export type AccessDecision =
  | { kind: "grant"; expiresSeconds: 300 | 900 }
  | { kind: "review"; reason: "payment_not_settled" | "high_risk" };

export function decideReceiptAccess(input: ReceiptRequest): AccessDecision {
  if (input.event !== "payment_settled") return { kind: "review", reason: "payment_not_settled" };
  if (input.risk === "high") return { kind: "review", reason: "high_risk" };
  return { kind: "grant", expiresSeconds: input.risk === "medium" ? 300 : 900 };
}

export type AuditNotification = {
  type: "receipt_access_granted" | "receipt_access_reviewed";
  paymentId: string;
  accountId: string;
  decision: "grant" | "review";
  reason?: "payment_not_settled" | "high_risk";
  objectKey?: string;
};

export type ReceiptOutcome =
  | { status: "ready"; downloadUrl: string; expiresSeconds: 300 | 900; audit: AuditNotification }
  | { status: "review"; audit: AuditNotification }
  | { status: "not_found"; audit: AuditNotification };

type ReceiptStorage = {
  head(bucket: string, key: string): Promise<{ found: boolean }>;
  presign(bucket: string, key: string, expiresSeconds: number, disposition: string): Promise<{ url: string }>;
};

export async function authorizeReceiptDownload(
  input: ReceiptRequest,
  storage: ReceiptStorage = {
    head: infrai.storage.object.head,
    presign: infrai.storage.object.presign,
  },
): Promise<ReceiptOutcome> {
  const decision = decideReceiptAccess(input);
  if (decision.kind === "review") {
    return {
      status: "review",
      audit: {
        type: "receipt_access_reviewed",
        paymentId: input.paymentId,
        accountId: input.accountId,
        decision: "review",
        reason: decision.reason,
      },
    };
  }

  const objectKey = `receipts/${input.accountId}/${input.paymentId}.pdf`;
  const object = await storage.head(process.env.RECEIPT_BUCKET ?? "private-payment-receipts", objectKey);
  if (!object.found) {
    return {
      status: "not_found",
      audit: {
        type: "receipt_access_reviewed",
        paymentId: input.paymentId,
        accountId: input.accountId,
        decision: "review",
        objectKey,
      },
    };
  }

  const bucket = process.env.RECEIPT_BUCKET ?? "private-payment-receipts";
  const signed = await storage.presign(
    bucket,
    objectKey,
    decision.expiresSeconds,
    `attachment; filename="receipt-${input.paymentId}.pdf"`,
  );
  return {
    status: "ready",
    downloadUrl: signed.url,
    expiresSeconds: decision.expiresSeconds,
    audit: {
      type: "receipt_access_granted",
      paymentId: input.paymentId,
      accountId: input.accountId,
      decision: "grant",
      objectKey,
    },
  };
}
