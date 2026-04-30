/**
 * HiveLiability — OpenAPI 3.1 spec builder
 *
 * Returns the full OpenAPI spec including the x-mpp discovery block
 * for MPPScan and agent autodiscovery.
 *
 * Called by GET /openapi.json (free endpoint).
 */

import { getSignerKey, bytesToBase64url } from './lib/sign.js';
import { VERSION, ISSUER_DID, TREASURY } from './version.js';

export async function buildOpenApiSpec() {
  const { pubKey } = await getSignerKey();
  const pubkeyHex  = Buffer.from(pubKey).toString('hex');
  const pubkeyB64u = bytesToBase64url(pubKey);

  return {
    openapi: '3.1.0',
    info: {
      title:       'HiveLiability',
      version:     VERSION,
      description: [
        'Insurance documentation generator and EU AI Act compliance evidence service.',
        'Aggregates HiveAudit receipts, HiveLens fleet snapshots, HiveCredential scope ledger,',
        'and HiveOrigin model-pedigree certs over a date window.',
        'Emits sealed Ed25519-signed JSON manifests (PDF stub in v0.1).',
        'Part of the AUTHENTICATABLE pillar of Hive Civilization.',
        'Real rails only: x402 (Base USDC) + IETF MPP (Tempo USDCe).',
      ].join(' '),
      contact: {
        name:  'Hive Civilization',
        email: 'steve@thehiveryiq.com',
        url:   'https://hiveliability.onrender.com',
      },
      license: { name: 'MIT' },
    },
    servers: [
      { url: 'https://hiveliability.onrender.com', description: 'Production' },
    ],

    // ─── x-mpp block (MPPScan discovery) ───────────────────────────
    'x-mpp': {
      realm:             'hiveliability.onrender.com',
      service_did:       ISSUER_DID,
      issuer_pubkey_hex: pubkeyHex,
      issuer_pubkey_b64u: pubkeyB64u,
      treasury:          TREASURY,
      payment: {
        method:    'tempo',
        currency:  'USDCe',
        contract:  '0x20c000000000000000000000b9537d11c60e8b50',
        decimals:  6,
        recipient: TREASURY,
        network:   'tempo',
        rpc:       'https://rpc.tempo.xyz',
      },
      rails: ['x402', 'mpp'],
      x402: {
        currency:  'USDC',
        contract:  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        network:   'base',
        chain_id:  8453,
        recipient: TREASURY,
      },
      categories:  ['insurance', 'compliance', 'eu-ai-act', 'fleet-documentation'],
      integration: 'first-party',
      pillar:      'AUTHENTICATABLE',
      tags: [
        'insurance-documentation',
        'eu-ai-act',
        'authenticatable',
        'hive-liability',
        'hive-civilization',
        'institutional',
        'ed25519',
        'signed-envelopes',
        'fleet-compliance',
      ],
      pricing: [
        { path: '/v1/liability/bundle/issue',  method: 'POST', amount: 250.00,   currency: 'USDC' },
        { path: '/v1/liability/bundle/verify', method: 'POST', amount: 0.05,     currency: 'USDC' },
        { path: '/v1/liability/bundle/{id}',   method: 'GET',  amount: 0.10,     currency: 'USDC' },
        { path: '/v1/liability/subscribe',     method: 'POST', amount: 2500.00,  currency: 'USDC', billing_cycle: 'monthly' },
        { path: '/v1/liability/attest',        method: 'POST', amount: 5.00,     currency: 'USDC' },
      ],
    },

    paths: {
      '/health': {
        get: {
          summary:     'Liveness check',
          operationId: 'getHealth',
          tags:        ['meta'],
          security:    [],
          responses: {
            '200': { description: 'Service healthy' },
          },
        },
      },

      '/openapi.json': {
        get: {
          summary:     'OpenAPI spec + x-mpp discovery block',
          operationId: 'getOpenApi',
          tags:        ['meta'],
          security:    [],
          responses: {
            '200': { description: 'OpenAPI 3.1 spec with x-mpp block' },
          },
        },
      },

      '/v1/liability/pubkey': {
        get: {
          summary:     'Ed25519 issuer pubkey for offline envelope verification',
          operationId: 'getLiabilityPubkey',
          tags:        ['auth'],
          security:    [],
          responses: {
            '200': {
              description: 'Issuer pubkey (hex + base64url)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      issuer:      { type: 'string' },
                      algorithm:   { type: 'string' },
                      pubkey_b64u: { type: 'string' },
                      pubkey_hex:  { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      '/v1/liability/bundle/issue': {
        post: {
          summary:     'Issue a fleet liability documentation bundle',
          operationId: 'postBundleIssue',
          tags:        ['bundle'],
          'x-price-usdc': 250.00,
          description: [
            'Aggregates HiveAudit receipts, HiveLens fleet snapshots, HiveCredential scope ledger,',
            'and HiveOrigin model-pedigree certs over the specified date window.',
            'Returns a sealed Ed25519-signed JSON manifest. PDF generation is a TODO for v0.2.',
            'Bundle can be handed to an insurer or regulator under EU AI Act Article 14/15.',
          ].join(' '),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fleet_did', 'window_start_iso', 'window_end_iso'],
                  properties: {
                    fleet_did:        { type: 'string', description: 'DID of the fleet (^did:[a-z0-9]+:[a-zA-Z0-9._-]+$)' },
                    window_start_iso: { type: 'string', format: 'date-time', description: 'Window start (ISO 8601)' },
                    window_end_iso:   { type: 'string', format: 'date-time', description: 'Window end (ISO 8601, must be after start and not in the future)' },
                    categories: {
                      type:  'array',
                      items: {
                        type: 'string',
                        enum: [
                          'gdpr_article_14', 'eu_ai_act_article_14', 'eu_ai_act_article_15',
                          'iso_42001', 'nist_ai_rmf', 'sec_ai_disclosure', 'general_insurance',
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Signed bundle manifest (bundle_id + sha256 + pubkey + sig)' },
            '400': { description: 'Validation error' },
            '402': { description: 'Payment required — x402 or MPP' },
          },
        },
      },

      '/v1/liability/bundle/verify': {
        post: {
          summary:     'Verify bundle signature and ledger presence',
          operationId: 'postBundleVerify',
          tags:        ['bundle'],
          'x-price-usdc': 0.05,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    bundle_id: { type: 'string', description: 'did:hive:hiveliability/bundle/<sha256-hex>' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Verification result: in_ledger, signature_valid' },
            '400': { description: 'Invalid bundle_id format' },
            '402': { description: 'Payment required' },
          },
        },
      },

      '/v1/liability/bundle/{bundle_id}': {
        get: {
          summary:     'Fetch bundle metadata by bundle_id',
          operationId: 'getBundleById',
          tags:        ['bundle'],
          'x-price-usdc': 0.10,
          parameters: [
            {
              name: 'bundle_id', in: 'path', required: true,
              schema: { type: 'string' },
              description: 'did:hive:hiveliability/bundle/<sha256-hex>',
            },
          ],
          responses: {
            '200': { description: 'Bundle metadata' },
            '404': { description: 'Bundle not found' },
            '402': { description: 'Payment required' },
          },
        },
      },

      '/v1/liability/subscribe': {
        post: {
          summary:     'Fleet subscription intent ($2,500 USDC/mo — Stripe wiring TODO)',
          operationId: 'postSubscribe',
          tags:        ['billing'],
          'x-price-usdc': 2500.00,
          'x-billing-cycle': 'monthly',
          'x-todo': 'Stripe webhook wiring required before billing goes live',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fleet_did'],
                  properties: {
                    fleet_did: { type: 'string' },
                    plan:      { type: 'string', enum: ['standard', 'enterprise'] },
                  },
                },
              },
            },
          },
          responses: {
            '402': { description: 'Payment required — returns Stripe checkout URL placeholder' },
            '400': { description: 'Invalid request body' },
          },
        },
      },

      '/v1/liability/attest': {
        post: {
          summary:     'Single-event fleet attestation ($5 USDC)',
          operationId: 'postAttest',
          tags:        ['attestation'],
          'x-price-usdc': 5.00,
          description: 'Lighter-weight than a full bundle. Attests a single event such as "fleet X emitted N decisions in window Y under scope Z".',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fleet_did', 'event_type'],
                  properties: {
                    fleet_did:        { type: 'string' },
                    event_type:       { type: 'string', description: 'e.g. decision_count, scope_assertion, audit_completion' },
                    window_start_iso: { type: 'string', format: 'date-time' },
                    window_end_iso:   { type: 'string', format: 'date-time' },
                    scope:            { type: 'string', description: 'Scope identifier (optional)' },
                    metadata:         { type: 'object', description: 'Arbitrary metadata (optional)' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Signed attestation envelope' },
            '400': { description: 'Validation error' },
            '402': { description: 'Payment required' },
          },
        },
      },
    },

    components: {
      securitySchemes: {
        x402: {
          type:        'apiKey',
          in:          'header',
          name:        'X-Payment-Hash',
          description: 'On-chain USDC transaction hash (Base, chain ID 8453)',
        },
        mpp: {
          type:        'apiKey',
          in:          'header',
          name:        'Payment',
          description: 'MPP payment credential: Payment: scheme="mpp", tx_hash="0x...", rail="tempo", amount="<amount>"',
        },
        internal: {
          type:        'apiKey',
          in:          'header',
          name:        'X-Hive-Internal-Key',
          description: 'Internal service key (server-side bypass, not for external callers)',
        },
      },
    },

    security: [{ x402: [] }, { mpp: [] }],
  };
}
