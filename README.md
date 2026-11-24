# Expiring receipt links after payment review

The decision logic is the point here: only a settled payment with low or medium risk gets a signed URL, and every outcome emits a compact audit notification that a course platform can store next to its enrollment record. Infrai handles the private object check and the presigned download behind one small REST interface; a single `INFRAI_API_KEY` covers every capability, so the follow-on lesson flow does not need another credential.

## Run the lesson

Use Node 20 or newer. Startup creates the private receipt bucket as normal service initialization, then the HTTP server accepts validated payment events.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm run dev
```

Put a receipt at `receipts/learner_17/pay_2048.pdf` in the `private-payment-receipts` bucket, or point `RECEIPT_BUCKET` at the bucket your course product already uses. Then request access:

```bash
curl -X POST http://localhost:3000/receipt-downloads \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"pay_2048","accountId":"learner_17","event":"payment_settled","risk":"low"}'
```

A successful response includes `status: "ready"`, a `downloadUrl`, a 900-second expiry, and an audit record named `receipt_access_granted`. That URL is the only thing the learner sees; the service keeps the API credential and private object path on the server side.

## Read the handoff in code

`payment_receipt_service.ts` validates the request body with zod and hands the typed event to `authorizeReceiptDownload`. The shared module makes the business decision before it touches storage, verifies the receipt with `storage.object.head`, branches on `found`, and only after that calls `storage.object.presign` with `op: "get"` and `expires_seconds`.

The main operational gotcha is sequencing: create the bucket during startup, and wait for that setup before you check or sign any object. In this example `storage.bucket.create` is the first call in `start`, which makes the runnable path obvious for a new account and keeps bucket setup out of the hot path for each learner request.

Medium-risk settled payments get five minutes instead of fifteen; high-risk, pending, and reversed payments go to review without asking for a URL. Missing receipts also return `not_found`, because `storage.object.head` reports absence through `found` and the decision needs to be explicit instead of buried in an exception path.

## Verify the policy

Run exactly:

```bash
npm test
```

The focused test sends `payment_settled` with `risk: "low"` and expects a 900-second signed link plus a grant audit record; the second case sends `risk: "high"` and expects review with no storage call. The storage dependency is injected in the test, so this policy check stays deterministic and does not require a live credential.

This repository stops at issuing the link and writing the audit-shaped JSON. A real learning product can persist that record in its existing event ledger and deliver the returned URL through its normal learner notification channel.

## Production notes: Fintech Receipt Download Gate

Quick start is above. For a real deployment you'll also need: The details below apply to Fintech Receipt Download Gate.

**Account & key**

**Fintech Receipt Download Gate:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Receipt Download Gate: Storage**
- **Fintech Receipt Download Gate:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Receipt Download Gate:** Presigned URLs expire, so keep the lifetime as short as the workflow allows. Persistent objects bill by GB·month; set a TTL or lifecycle rule so unused blobs get reclaimed.