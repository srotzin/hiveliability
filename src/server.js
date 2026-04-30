/**
 * HiveLiability — Express 5 application
 *
 * Insurance documentation generator and EU AI Act compliance evidence service.
 * Real rails only: x402 (Base USDC) + IETF MPP (Tempo USDCe).
 * Every paid response is a JCS-canonical Ed25519-signed envelope.
 *
 * Service DID: did:hive:hiveliability
 * Treasury: 0x15184bf50b3d3f52b60434f8942b7d52f2eb436e
 * Issuer: did:hive:hiveliability
 */

import express from 'express';
import x402Middleware   from './middleware/x402.js';
import mppMiddleware    from './middleware/mpp.js';
import liabilityRouter  from './routes/liability.js';
import { buildOpenApiSpec } from './openapi.js';
import { getSignerKey, ISSUER_DID } from './lib/sign.js';
import { VERSION, TREASURY, RAILS } from './version.js';

const app = express();
app.use(express.json());

// ─── /health ─────────────────────────────────────────────────
// Free. Liveness check.

app.get('/health', (req, res) => {
  return res.json({
    service:    'hiveliability',
    version:    VERSION,
    status:     'ok',
    treasury:   TREASURY,
    rails:      RAILS,
    issuer_did: ISSUER_DID,
    pillar:     'AUTHENTICATABLE',
    timestamp:  new Date().toISOString(),
    todos: [
      'TODO(v0.2): Postgres liability_bundles table',
      'TODO(v0.2): PDF generation via pdfkit',
      'TODO(v0.2): Stripe subscription billing',
      'TODO(v0.2): Cross-service receipt aggregation (hivetrust + hivelens + hiveorigin)',
      'TODO(v0.2): HiveAudit integration once HiveAudit is live',
    ],
  });
});

// ─── /openapi.json ───────────────────────────────────────────
// Free. MPPScan discovery + x-mpp block.

app.get('/openapi.json', async (req, res) => {
  try {
    const spec = await buildOpenApiSpec();
    return res.json(spec);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Payment middleware on /v1 ────────────────────────────────
// x402 runs first (handles Base USDC); MPP runs second (handles Tempo USDCe).
// Either rail satisfies payment — next() propagates to routes.

app.use('/v1', x402Middleware, mppMiddleware);

// ─── Routes ──────────────────────────────────────────────────

app.use('/v1/liability', liabilityRouter);

// ─── 404 handler ─────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code:  'NOT_FOUND',
    path:  req.path,
  });
});

// ─── Error handler ───────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('[hiveliability] unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    code:  'INTERNAL_ERROR',
  });
});

export default app;
