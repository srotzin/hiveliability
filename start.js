/**
 * HiveLiability — start.js
 * Entry point. Loads env, then starts the Express server.
 * Separated from server.js for test isolation.
 */

import 'dotenv/config';
import app from './src/server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  console.log(`[hiveliability] listening on port ${PORT}`);
  console.log(`[hiveliability] version 0.1.0 — insurance documentation service`);
  console.log(`[hiveliability] issuer: did:hive:hiveliability`);
  console.log(`[hiveliability] treasury: 0x15184bf50b3d3f52b60434f8942b7d52f2eb436e`);
  console.log(`[hiveliability] rails: x402 (Base USDC) + MPP (Tempo USDCe)`);
});
