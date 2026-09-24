import assert from "node:assert/strict";
import test from "node:test";
import { authorizeReceiptDownload, decideReceiptAccess } from "../src/signed_receipt_download.js";

test("a settled low-risk payment receives a longer signed receipt link", async () => {
  const calls: string[] = [];
  const outcome = await authorizeReceiptDownload(
    { paymentId: "pay_2048", accountId: "learner_17", event: "payment_settled", risk: "low" },
    {
      async head(_bucket, key) {
        calls.push(`head:${key}`);
        return { found: true };
      },
      async presign(_bucket, key, expiresSeconds, _disposition) {
        calls.push(`presign:${key}:${expiresSeconds}`);
        return { url: "https://download.example.test/signed-receipt" };
      },
    },
  );

  assert.equal(outcome.status, "ready");
  if (outcome.status === "ready") {
    assert.equal(outcome.expiresSeconds, 900);
    assert.equal(outcome.audit.decision, "grant");
  }
  assert.deepEqual(calls, [
    "head:receipts/learner_17/pay_2048.pdf",
    "presign:receipts/learner_17/pay_2048.pdf:900",
  ]);
});

test("a high-risk payment is reviewed without touching storage", async () => {
  const decision = decideReceiptAccess({
    paymentId: "pay_4096",
    accountId: "learner_17",
    event: "payment_settled",
    risk: "high",
  });
  assert.deepEqual(decision, { kind: "review", reason: "high_risk" });
});
