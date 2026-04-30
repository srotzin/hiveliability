# HiveLiability v0.1

Insurance documentation generator and EU AI Act compliance evidence service for Hive Civilization fleet operators. Part of the **AUTHENTICATABLE** pillar.

## Purpose

An enterprise running a fleet under HiveAudit needs a "documentation package" to hand to their insurer (or to a regulator under EU AI Act Article 14/15) proving the fleet's behaviour over a window. HiveLiability:

1. Aggregates HiveAudit receipts + HiveLens fleet snapshots + HiveCredential scope ledger + HiveOrigin model-pedigree certs over a date window
2. Emits a single sealed PDF + JSON bundle, Ed25519-signed, with a machine-readable manifest
3. Charges per-bundle and per-month subscription

## Service Identity

| Field | Value |
|---|---|
| Service DID | `did:hive:hiveliability` |
| Treasury | `0x15184bf50b3d3f52b60434f8942b7d52f2eb436e` |
| Rails | x402 (Base USDC) + IETF MPP (Tempo USDCe) |
| Pillar | AUTHENTICATABLE |

## Endpoints

| Method | Path | Price | Description |
|---|---|---|---|
| GET | `/health` | FREE | Liveness check |
| GET | `/openapi.json` | FREE | OpenAPI 3.1 spec + x-mpp discovery |
| GET | `/v1/liability/pubkey` | FREE | Ed25519 issuer pubkey |
| POST | `/v1/liability/bundle/issue` | $250 USDC | Issue a fleet documentation bundle |
| POST | `/v1/liability/bundle/verify` | $0.05 USDC | Verify bundle signature + ledger |
| GET | `/v1/liability/bundle/:bundle_id` | $0.10 USDC | Fetch bundle metadata |
| POST | `/v1/liability/subscribe` | $2,500 USDC/mo | Fleet subscription (scaffold) |
| POST | `/v1/liability/attest` | $5 USDC | Single-event attestation |

## Payment Rails

**x402 (Base USDC):**
```
X-Payment-Hash: <confirmed Base USDC tx hash>
```

**IETF MPP (Tempo USDCe):**
```
Payment: scheme="mpp", tx_hash="0x...", rail="tempo", amount="<amount>"
```

## Validation

- `fleet_did` must match `^did:[a-z0-9]+:[a-zA-Z0-9._-]+$`
- ISO 8601 timestamps; `window_end` must be after `window_start` and window must not be in the future
- `categories` must be one of: `gdpr_article_14`, `eu_ai_act_article_14`, `eu_ai_act_article_15`, `iso_42001`, `nist_ai_rmf`, `sec_ai_disclosure`, `general_insurance`
- `bundle_id` format: `did:hive:hiveliability/bundle/<sha256-hex>`

## Architecture

- ESM Express 5, `server.js` + `start.js` split, port 3000
- Ed25519 via `@noble/ed25519`, JCS-canonical via internal `canonical.js`
- In-memory `bundles` Map for v0.1
- Spectral receipts emitted non-blocking to `https://hive-receipt.onrender.com/v1/receipt/sign`

## Environment Variables

| Variable | Purpose |
|---|---|
| `LIABILITY_SIGNING_SEED` | 64-char hex seed for stable Ed25519 key (optional) |
| `HIVE_INTERNAL_KEY` | Internal service bypass key |
| `HIVE_PAYMENT_ADDRESS` | Treasury address override |
| `BASE_RPC_URL` | Base L2 RPC override |
| `TEMPO_RPC_URL` | Tempo RPC override |
| `PORT` | Server port (default 3000) |

## TODOs (v0.2)

- [ ] Postgres `liability_bundles` table
- [ ] PDF generation via `pdfkit`
- [ ] Stripe subscription billing
- [ ] Cross-service receipt aggregation (real fetches to hivetrust + hivelens + hiveorigin)
- [ ] HiveAudit integration once HiveAudit is live

## Quick Start

```bash
npm install
node start.js
```

## License

MIT — see [LICENSE](LICENSE)
