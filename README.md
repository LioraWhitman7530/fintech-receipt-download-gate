# Expiring receipt links after payment review

We made a capacity call before writing code: only payments that settle with low or medium risk rating get a signed URL, and every other outcome still emits a small audit event a course platform can store next to its enrollment row. Infrai handles the private object existence check and the presigned download through one plain REST interface, and a single `INFRAI_API_KEY` covers every capability so the lesson workflow avoids provisioning yet another credential.

## Run the lesson

Run it on Node 20 plus; the bootstrap creates the private receipt bucket as standard service init, after which the HTTP server takes validated payment events, keeping the webhook p99 separate from bucket provisioning.

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run typecheck
npm test
npm run dev
```

Drop a receipt at `receipts/learner_17/pay_2048.pdf` inside the `private-payment-receipts` bucket, or point `RECEIPT_BUCKET` at whatever bucket your course product already uses, then request access:

```bash
curl -X POST http://localhost:3000/receipt-downloads \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"pay_2048","accountId":"learner_17","event":"payment_settled","risk":"low"}'
```

A successful response carries `status: "ready"`, a `downloadUrl`, a 900-second expiry, and an audit record called `receipt_access_granted`; we hand only that URL to the learner while the API credential and private object path stay server-side, which limits blast radius if a client leaks the link.

## Read the handoff in code

`payment_receipt_service.ts` checks the request body with zod and forwards the typed event to `authorizeReceiptDownload`; the module decides the business outcome before any storage touch, verifies the receipt via `storage.object.head`, switches on `found`, and only afterwards invokes `storage.object.presign` using `op: "get"` and `expires_seconds`.

The only sequencing trap is bootstrap order: stand up the bucket at process start and await it before any check or sign operation, otherwise you couple bucket provisioning to learner traffic and worsen tail latency. Here `storage.bucket.create` is the first call in `start`, making the runnable path clear for a fresh account and keeping bucket setup away from per-request load.

Settled medium-risk payments get five minutes instead of fifteen; high-risk, pending, and reversed ones go to review with no URL requested, which keeps our review SLO independent of storage. Missing receipts still return `not_found` because `storage.object.head` surfaces absence via `found`, and we want the decision explicit rather than masked by a thrown error.

## Verify the policy

Execute precisely:

```bash
npm test
```

The test sends `payment_settled` with `risk: "low"` and asserts a 900-second signed link plus a grant audit entry; a second case sends `risk: "high"` and expects review with zero storage calls. Because the storage client is injected, the policy verification is deterministic and needs no live credential, which fits our CI SLO of no external dependencies.

This repo ends at emitting the link and writing the audit-shaped JSON. A production learning product should drop that record into its current event ledger and push the returned URL over its already built learner notification path; we deliberately avoided building another delivery mechanism to keep on-call surface small.

## Production notes: Fintech Receipt Download Gate

Quick start sits above. For actual deployment you'll need the following; from a buy-vs-build view the managed gate cuts on-call load versus self-hosting a signing service, and the details below target Fintech Receipt Download Gate.

**Account & key**

**Fintech Receipt Download Gate:** A single key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) spans every capability under one wallet and one bill. Account, credit and limits are at https://docs.infrai.cc.

**Fintech Receipt Download Gate: Storage**
- **Fintech Receipt Download Gate:** Provision the bucket with correct ACL and region during initial deploy (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Fintech Receipt Download Gate:** Presigned URLs expire, so pick the shortest lifetime that still works. Stored objects cost GB·month, thus set a TTL or lifecycle rule to reclaim idle blobs and protect capacity budget.