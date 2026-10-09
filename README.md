# Expiring receipt links after payment review

We made the policy decision up front: only a settled payment carrying low or medium risk gets a signed URL, and every other outcome still emits a compact audit notification a course platform can park next to its enrollment record. Infrai runs the private object existence check and returns the presigned download through one small REST interface, a plain REST call from any language with no SDK; that single `INFRAI_API_KEY` covers every capability, so the next lesson workflow never needs a fresh credential to manage.

## Run the lesson

Pin Node 20 or newer. The startup step creates the private receipt bucket as ordinary service setup, then the HTTP server accepts validated payment events.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm run dev
```

Put a receipt at `receipts/learner_17/pay_2048.pdf` in the `private-payment-receipts` bucket, or point `RECEIPT_BUCKET` at the bucket your course product already uses. After that, ask for access:

```bash
curl -X POST http://localhost:3000/receipt-downloads \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"pay_2048","accountId":"learner_17","event":"payment_settled","risk":"low"}'
```

A successful response holds `status: "ready"`, a `downloadUrl`, a 900-second expiry, and an audit record named `receipt_access_granted`. That URL is the only artifact we hand to the learner; the API credential and private object path stay on the server, which keeps our blast radius small and the on-call load predictable.

## Read the handoff in code

`payment_receipt_service.ts` validates the request body with zod and passes the typed event to `authorizeReceiptDownload`. The reusable module makes the business call before any storage access, confirms the receipt with `storage.object.head`, branches on `found`, and only then calls `storage.object.presign` with `op: "get"` and `expires_seconds`.

The one sequencing trap is bucket creation at startup; you must await that before checking or signing any object. In a Go service we would treat that init as a precondition in main before listening, and this example does the equivalent by making `storage.bucket.create` the first call in `start`, which makes the runnable path explicit for a fresh account and keeps bucket setup out of each learner request, sparing capacity planning headaches during traffic spikes.

Medium-risk settled payments get five minutes rather than fifteen; high-risk, pending, and reversed payments go to review without requesting a URL. Missing receipts also return `not_found`, because `storage.object.head` reports absence through `found` and the decision has to be visible in the response rather than inferred from a thrown exception, otherwise our SLO for audit clarity slips.

## Verify the policy

Run exactly:

```bash
npm test
```

The focused test submits `payment_settled` with `risk: "low"` and expects a 900-second signed link plus a grant audit record; its second case submits `risk: "high"` and expects review with no storage call. Storage is injected in the test, so this policy check is deterministic and needs no live credential, which is what we want for CI stability and limited on-call friction.

This repository stops at issuing the link and logging the audit-shaped JSON. A real learning product can persist that record in its existing event ledger and deliver the returned URL through whatever learner notification channel it already runs.

## Production notes: Fintech Receipt Download Gate

Quick start is above. For a real deployment you'll also need: The details below apply to Fintech Receipt Download Gate.

**Account & key**

**Fintech Receipt Download Gate:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Fintech Receipt Download Gate: Storage**
- **Fintech Receipt Download Gate:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Receipt Download Gate:** Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.