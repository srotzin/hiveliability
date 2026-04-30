/**
 * HiveLiability — /v1/liability routes
 *
 * All paid responses are JCS-canonical Ed25519-signed envelopes.
 * In-memory bundle store (v0.1 — TODO Postgres liability_bundles table).
 *
 * Endpoints:
 *   GET  /pubkey                  — FREE, Ed25519 issuer pubkey
 *   POST /bundle/issue            — $250 USDC, fleet liability bundle
 *   POST /bundle/verify           — $0.05 USDC, verify bundle signature
 *   GET  /bundle/:bundle_id       — $0.10 USDC, fetch bundle metadata
 *   POST /subscribe               — $2,500 USDC/mo (scaffold, Stripe TODO)
 *   POST /attest                  — $5 USDC, single-event attestation
 *
 * Validation:
 *   fleet_did    → /^did:[a-z0-9]+:[a-zA-Z0-9._-]+$/
 *   ISO 8601     → window_end > window_start, window not in future
 *   categories   → whitelist (gdpr_article_14 etc.)
 *   bundle_id    → did:hive:hiveliability/bundle/<sha256-hex>
 *
 * TODO (v0.2):
 *   - Postgres liability_bundles table
 *   - PDF generation via pdfkit
 *   - Stripe subscription billing
 *   - Cross-service receipt aggregation (hivetrust + hivelens + hiveorigin)
 *   - HiveAudit integration once HiveAudit is live
 */

import { Router } from 'express';
import { createHash } from 'crypto';
import * as ed from '@noble/ed25519';
import { signEnvelope, getSignerKey, bytesToBase64url, ISSUER_DID, canonicalize, canonicalBytes } from '../lib/sign.js';
import { emitReceipt } from '../lib/receipt.js';

const router = Router();

// ─── Constants ───────────────────────────────────────────────

const VALID_CATEGORIES = new Set([
  'gdpr_article_14',
  'eu_ai_act_article_14',
  'eu_ai_act_article_15',
  'iso_42001',
  'nist_ai_rmf',
  'sec_ai_disclosure',
  'general_insurance',
]);

const FLEET_DID_REGEX = /^did:[a-z0-9]+:[a-zA-Z0-9._-]+$/;

// ─── In-memory bundle store (v0.1) ───────────────────────────
// TODO (v0.2): Replace with Postgres liability_bundles table.
const bundles = new Map();

// ─── Subscription intent store (v0.1) ────────────────────────
// TODO (v0.2): Replace with Postgres + Stripe webhook wiring.
const subscriptions = new Map();

// ─── Helpers ─────────────────────────────────────────────────

function requirePayment(req, res) {
  if (!req.paymentVerified) {
    res.status(402).json({
      success: false,
      error:   'Payment required',
      code:    'PAYMENT_REQUIRED',
    });
    return false;
  }
  return true;
}

function makeBundleId(sha256Hex) {
  return `did:hive:hiveliability/bundle/${sha256Hex}`;
}

function parseBundleId(bundleId) {
  const prefix = 'did:hive:hiveliability/bundle/';
  if (!bundleId || !bundleId.startsWith(prefix)) return null;
  return bundleId.slice(prefix.length);
}

// ─── GET /pubkey ──────────────────────────────────────────────
// Free. Returns Ed25519 pubkey for offline verification of signed envelopes.

router.get('/pubkey', async (req, res) => {
  try {
    const { pubKey } = await getSignerKey();
    return res.json({
      issuer:       ISSUER_DID,
      algorithm:    'Ed25519',
      pubkey_b64u:  bytesToBase64url(pubKey),
      pubkey_hex:   Buffer.from(pubKey).toString('hex'),
      usage:        'Verify JCS-canonical Ed25519 signatures on all paid HiveLiability responses.',
      verify_steps: [
        '1. Fetch this pubkey',
        '2. Canonicalize envelope via JCS (RFC 8785)',
        '3. Base64url-decode signature_b64u from proof',
        '4. ed25519.verify(signature, canonicalBytes, pubkey)',
      ],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /bundle/issue ───────────────────────────────────────
// $250 USDC
// Body: { fleet_did, window_start_iso, window_end_iso, categories:[] }
// Returns: signed bundle manifest with bundle_id + sha256 + pubkey + sig
//
// v0.1: in-memory bundle store. PDF stub (TODO pdfkit generation).
// The JSON manifest is real and signed.

router.post('/bundle/issue', async (req, res) => {
  if (!requirePayment(req, res)) return;

  const { fleet_did, window_start_iso, window_end_iso, categories } = req.body || {};

  // Validate fleet_did
  if (!fleet_did || !FLEET_DID_REGEX.test(fleet_did)) {
    return res.status(400).json({
      success: false,
      error:   'fleet_did must match ^did:[a-z0-9]+:[a-zA-Z0-9._-]+$',
      code:    'INVALID_FLEET_DID',
    });
  }

  // Validate window_start_iso
  if (!window_start_iso || isNaN(Date.parse(window_start_iso))) {
    return res.status(400).json({
      success: false,
      error:   'window_start_iso must be a valid ISO 8601 timestamp',
      code:    'INVALID_WINDOW_START',
    });
  }

  // Validate window_end_iso
  if (!window_end_iso || isNaN(Date.parse(window_end_iso))) {
    return res.status(400).json({
      success: false,
      error:   'window_end_iso must be a valid ISO 8601 timestamp',
      code:    'INVALID_WINDOW_END',
    });
  }

  const windowStart = new Date(window_start_iso);
  const windowEnd   = new Date(window_end_iso);
  const now         = new Date();

  // window_end must be after window_start
  if (windowEnd <= windowStart) {
    return res.status(400).json({
      success: false,
      error:   'window_end_iso must be after window_start_iso',
      code:    'INVALID_WINDOW_ORDER',
    });
  }

  // window must not be in the future
  if (windowStart > now) {
    return res.status(400).json({
      success: false,
      error:   'window_start_iso must not be in the future',
      code:    'WINDOW_IN_FUTURE',
    });
  }

  // Validate categories
  const requestedCategories = Array.isArray(categories) ? categories : [];
  const invalidCategories = requestedCategories.filter(c => !VALID_CATEGORIES.has(c));
  if (invalidCategories.length > 0) {
    return res.status(400).json({
      success: false,
      error:   `Invalid categories: ${invalidCategories.join(', ')}`,
      code:    'INVALID_CATEGORIES',
      valid_categories: Array.from(VALID_CATEGORIES),
    });
  }

  const effectiveCategories = requestedCategories.length > 0
    ? requestedCategories
    : ['general_insurance'];

  try {
    const { pubKey } = await getSignerKey();
    const pubkeyHex  = Buffer.from(pubKey).toString('hex');

    // v0.1 aggregate stubs — TODO: real cross-service fetch from
    // hivetrust + hivelens + hiveorigin + HiveAudit once live.
    const dataSourceStubs = {
      hiveaudit_receipts:    { status: 'TODO_HIVEAUDIT_NOT_YET_LIVE', count: 0 },
      hivelens_snapshots:    { status: 'TODO_FETCH_V0_2', count: 0 },
      hivecredential_scopes: { status: 'TODO_FETCH_V0_2', count: 0 },
      hiveorigin_certs:      { status: 'TODO_FETCH_V0_2', count: 0 },
    };

    const bundlePayload = {
      version:          'hiveliability/bundle/v1',
      issuer_did:       ISSUER_DID,
      fleet_did,
      window_start_iso: windowStart.toISOString(),
      window_end_iso:   windowEnd.toISOString(),
      categories:       effectiveCategories,
      data_sources:     dataSourceStubs,
      pdf_status:       'TODO_PDF_GENERATION_V0_2',
      generated_at:     now.toISOString(),
    };

    // Compute SHA-256 of canonical bundle payload
    const canonicalStr = canonicalize(bundlePayload);
    const sha256Hex = createHash('sha256')
      .update(Buffer.from(canonicalStr, 'utf8'))
      .digest('hex');

    const bundle_id = makeBundleId(sha256Hex);

    const manifest = {
      bundle_id,
      sha256:    sha256Hex,
      issuer:    ISSUER_DID,
      pubkey_hex: pubkeyHex,
      fleet_did,
      window_start_iso: windowStart.toISOString(),
      window_end_iso:   windowEnd.toISOString(),
      categories: effectiveCategories,
      bundle_payload: bundlePayload,
    };

    const signed = await signEnvelope(manifest);

    // Store in-memory (v0.1)
    bundles.set(bundle_id, {
      bundle_id,
      sha256: sha256Hex,
      fleet_did,
      window_start_iso: windowStart.toISOString(),
      window_end_iso:   windowEnd.toISOString(),
      categories: effectiveCategories,
      issued_at:  now.toISOString(),
      signed,
    });

    emitReceipt({
      path:          '/v1/liability/bundle/issue',
      amount:        250,
      eventType:     'liability.bundle.issue',
      refId:         bundle_id,
      paymentMethod: req.paymentMethod,
    });

    return res.json({ success: true, bundle_id, sha256: sha256Hex, ...signed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /bundle/verify ──────────────────────────────────────
// $0.05 USDC
// Body: { bundle_id } or full bundle JSON
// Verifies signature against pubkey and returns validity + ledger lookup.

router.post('/bundle/verify', async (req, res) => {
  if (!requirePayment(req, res)) return;

  const body = req.body || {};
  let bundleId = body.bundle_id;
  let incomingBundle = null;

  // If body contains envelope/proof fields, treat as full bundle JSON
  if (!bundleId && body.envelope && body.proof) {
    incomingBundle = body;
    // Extract bundle_id from the envelope if present
    bundleId = body.envelope?.bundle_id;
  }

  if (!bundleId) {
    return res.status(400).json({
      success: false,
      error:   'bundle_id is required (or supply full signed bundle JSON)',
      code:    'MISSING_BUNDLE_ID',
    });
  }

  // Validate bundle_id format
  const sha256FromId = parseBundleId(bundleId);
  if (!sha256FromId || !/^[0-9a-f]{64}$/.test(sha256FromId)) {
    return res.status(400).json({
      success: false,
      error:   'bundle_id must be did:hive:hiveliability/bundle/<sha256-hex>',
      code:    'INVALID_BUNDLE_ID_FORMAT',
    });
  }

  // Ledger lookup
  const stored = bundles.get(bundleId);

  // If full bundle provided, verify the signature
  let signatureValid = null;
  let signatureError = null;

  if (incomingBundle?.proof) {
    try {
      const sigB64u = incomingBundle.proof.signature_b64u;
      const pubB64u = incomingBundle.proof.pubkey_b64u;

      if (sigB64u && pubB64u) {
        const sigBytes = Uint8Array.from(
          Buffer.from(sigB64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        );
        const pubBytes = Uint8Array.from(
          Buffer.from(pubB64u.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        );
        const msgBytes = canonicalBytes(incomingBundle.envelope);
        signatureValid = await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
      } else {
        signatureError = 'Missing signature_b64u or pubkey_b64u in proof';
      }
    } catch (e) {
      signatureError = `Signature verification error: ${e.message}`;
    }
  }

  emitReceipt({
    path:          '/v1/liability/bundle/verify',
    amount:        0.05,
    eventType:     'liability.bundle.verify',
    refId:         bundleId,
    paymentMethod: req.paymentMethod,
  });

  return res.json({
    success: true,
    bundle_id:       bundleId,
    sha256:          sha256FromId,
    in_ledger:       !!stored,
    issued_at:       stored?.issued_at || null,
    fleet_did:       stored?.fleet_did || null,
    categories:      stored?.categories || null,
    signature_valid: signatureValid,
    signature_error: signatureError,
    ledger:          'in-memory-v0.1',
    note:            stored
      ? 'Bundle found in ledger. Signature verification requires full bundle JSON in request body.'
      : 'Bundle not found in local ledger. May exist in a different instance or have been issued before this process started.',
  });
});

// ─── GET /bundle/:bundle_id ───────────────────────────────────
// $0.10 USDC
// Fetch bundle metadata.

router.get('/bundle/:sha256hex', async (req, res) => {
  if (!requirePayment(req, res)) return;

  // Accept either the full bundle_id or just the sha256 hex
  const rawParam = req.params.sha256hex;
  const bundleId = makeBundleId(rawParam);

  const sha256FromId = parseBundleId(bundleId);
  if (!sha256FromId) {
    return res.status(400).json({
      success: false,
      error:   'Invalid bundle_id format. Expected did:hive:hiveliability/bundle/<sha256-hex>',
      code:    'INVALID_BUNDLE_ID_FORMAT',
    });
  }

  const stored = bundles.get(bundleId);
  if (!stored) {
    return res.status(404).json({
      success: false,
      error:   'Bundle not found',
      code:    'BUNDLE_NOT_FOUND',
      bundle_id: bundleId,
    });
  }

  emitReceipt({
    path:          '/v1/liability/bundle/:bundle_id',
    amount:        0.10,
    eventType:     'liability.bundle.fetch',
    refId:         bundleId,
    paymentMethod: req.paymentMethod,
  });

  return res.json({
    success: true,
    bundle_id:        stored.bundle_id,
    sha256:           stored.sha256,
    fleet_did:        stored.fleet_did,
    window_start_iso: stored.window_start_iso,
    window_end_iso:   stored.window_end_iso,
    categories:       stored.categories,
    issued_at:        stored.issued_at,
    issuer_did:       ISSUER_DID,
  });
});

// ─── POST /subscribe ──────────────────────────────────────────
// $2,500 USDC/mo (scaffold — no live billing in v0.1)
// Body: { fleet_did, plan: 'standard' | 'enterprise' }
// Returns 402 with TODO_STRIPE_SESSION placeholder.
//
// TODO (v0.2): Wire Stripe webhook. Replace in-memory Map with Postgres.

router.post('/subscribe', async (req, res) => {
  const { fleet_did, plan } = req.body || {};

  if (!fleet_did || !FLEET_DID_REGEX.test(fleet_did)) {
    return res.status(400).json({
      success: false,
      error:   'fleet_did must match ^did:[a-z0-9]+:[a-zA-Z0-9._-]+$',
      code:    'INVALID_FLEET_DID',
    });
  }

  const validPlans = ['standard', 'enterprise'];
  if (plan && !validPlans.includes(plan)) {
    return res.status(400).json({
      success: false,
      error:   `plan must be one of: ${validPlans.join(', ')}`,
      code:    'INVALID_PLAN',
    });
  }

  const selectedPlan = plan || 'standard';
  const existing = subscriptions.get(fleet_did);
  const intent = {
    fleet_did,
    plan: selectedPlan,
    recorded_at: existing?.recorded_at || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
    status:      'pending_payment',
  };
  subscriptions.set(fleet_did, intent);

  // v0.1: always return 402 with Stripe placeholder
  return res.status(402).json({
    success:  false,
    error:    'Payment required to activate liability subscription',
    code:     'SUBSCRIPTION_PAYMENT_REQUIRED',
    todo:     'Stripe billing not yet wired. This is a v0.1 scaffold.',
    pricing: {
      amount:        2500.00,
      currency:      'USDC',
      billing_cycle: 'monthly',
      description:   'HiveLiability fleet documentation package — institutional tier',
      plans: {
        standard:   { amount: 2500.00, description: 'Standard fleet — up to 100 agents, quarterly bundles' },
        enterprise: { amount: 2500.00, description: 'Enterprise fleet — unlimited agents, continuous bundles' },
      },
    },
    checkout_url:    'https://checkout.stripe.com/c/pay/TODO_STRIPE_SESSION',
    intent_recorded: true,
    intent,
    rails_accepted: ['x402', 'mpp', 'stripe'],
    contact: 'steve@thehiveryiq.com',
  });
});

// ─── POST /attest ─────────────────────────────────────────────
// $5 USDC
// Single-event attestation (lighter weight than bundle).
// e.g. "fleet X emitted N decisions in window Y under scope Z"
// Body: { fleet_did, event_type, window_start_iso, window_end_iso, scope?, metadata? }

router.post('/attest', async (req, res) => {
  if (!requirePayment(req, res)) return;

  const { fleet_did, event_type, window_start_iso, window_end_iso, scope, metadata } = req.body || {};

  // Validate fleet_did
  if (!fleet_did || !FLEET_DID_REGEX.test(fleet_did)) {
    return res.status(400).json({
      success: false,
      error:   'fleet_did must match ^did:[a-z0-9]+:[a-zA-Z0-9._-]+$',
      code:    'INVALID_FLEET_DID',
    });
  }

  if (!event_type || typeof event_type !== 'string') {
    return res.status(400).json({
      success: false,
      error:   'event_type is required',
      code:    'MISSING_EVENT_TYPE',
    });
  }

  const windowStart = window_start_iso ? new Date(window_start_iso) : null;
  const windowEnd   = window_end_iso   ? new Date(window_end_iso)   : null;

  if (window_start_iso && isNaN(windowStart?.getTime())) {
    return res.status(400).json({
      success: false,
      error:   'window_start_iso must be a valid ISO 8601 timestamp',
      code:    'INVALID_WINDOW_START',
    });
  }
  if (window_end_iso && isNaN(windowEnd?.getTime())) {
    return res.status(400).json({
      success: false,
      error:   'window_end_iso must be a valid ISO 8601 timestamp',
      code:    'INVALID_WINDOW_END',
    });
  }
  if (windowStart && windowEnd && windowEnd <= windowStart) {
    return res.status(400).json({
      success: false,
      error:   'window_end_iso must be after window_start_iso',
      code:    'INVALID_WINDOW_ORDER',
    });
  }

  try {
    const now = new Date();

    const attestPayload = {
      version:          'hiveliability/attest/v1',
      issuer_did:       ISSUER_DID,
      fleet_did,
      event_type,
      window_start_iso: windowStart?.toISOString() || null,
      window_end_iso:   windowEnd?.toISOString()   || null,
      scope:            scope     || null,
      metadata:         metadata  || null,
      attested_at:      now.toISOString(),
    };

    const signed = await signEnvelope(attestPayload);

    emitReceipt({
      path:          '/v1/liability/attest',
      amount:        5,
      eventType:     'liability.attest',
      refId:         fleet_did,
      paymentMethod: req.paymentMethod,
    });

    return res.json({ success: true, ...signed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
