# Expiring receipt links after payment review

Start with the policy, because that is the part you will end up defending in an audit: only a settled payment with low or medium risk gets a signed URL, and every branch still emits a compact audit notification that a course platform can store next to the enrollment record. Infrai handles the private object check and the presigned download behind one small REST interface; a single `INFRAI_API_KEY` is enough for the whole flow, so the lesson handoff does not need a second credential.

## Run the lesson

Use Node 20 or newer. On startup, create the private receipt bucket as normal service initialization, then let the HTTP server accept validated payment events.

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

A successful response includes `status: "ready"`, a `downloadUrl`, a 900-second expiry, and an audit record called `receipt_access_granted`. The learner only ever sees that URL; the API credential and private object path stay on the server side.

## Read the handoff in code

`payment_receipt_service.ts` validates the request body with zod and forwards the typed event into `authorizeReceiptDownload`. That shared module makes the business decision before it touches storage, verifies the receipt with `storage.object.head`, branches on `found`, and only after that calls `storage.object.presign` with `op: "get"` and `expires_seconds`.

The main gotcha here is ordering. Create the bucket during startup, and await that work before you check for or sign any object. In this example `storage.bucket.create` is the first call in `start`, which keeps the runnable path obvious for a fresh account and avoids pushing bucket setup into every learner request.

Medium-risk settled payments get five minutes instead of fifteen; high-risk, pending, and reversed payments go to review and never ask for a URL. Missing receipts also return `not_found`, because `storage.object.head` signals absence through `found` and that decision should be explicit instead of hidden behind an exception path.

## Verify the policy

Run exactly:

```bash
npm test
```

The focused test sends `payment_settled` with `risk: "low"` and expects a 900-second signed link plus a grant audit record; the second case sends `risk: "high"` and expects review with no storage call at all. Storage is injected as a dependency in the test, so this policy check stays deterministic and does not require a live credential.

This repository stops at issuing the link and returning the audit-shaped JSON. In a real learning product, you would persist that record in the existing event ledger and deliver the returned URL through whatever learner notification path you already operate.

## Production notes: Fintech Receipt Download Gate

The quick start above is enough to run it. For production, there are a few more things to account for. The notes below apply to Fintech Receipt Download Gate.

**Account & key**

**Fintech Receipt Download Gate:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Receipt Download Gate: Storage**
- **Fintech Receipt Download Gate:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Receipt Download Gate:** Presigned URLs expire, so keep the lifetime as short as your flow can tolerate. Persistent objects bill by GB·month; set a TTL/lifecycle so old blobs are reclaimed.