const db = require('./db');

// Pricing per million tokens (USD)
const PRICING = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
};

const DEFAULT_PRICING = { input: 3, output: 15 };

function trackUsage({ model, inputTokens, outputTokens, tool, clientId, clientName }) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const costUSD = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  const entry = {
    timestamp: new Date().toISOString(),
    model,
    inputTokens,
    outputTokens,
    costUSD: Math.round(costUSD * 1_000_000) / 1_000_000,
    tool,
    clientId: clientId || '',
    clientName: clientName || '',
  };

  db.logUsage(entry);
  return entry;
}

function getUsageSummary() {
  return db.getUsageStats();
}

module.exports = { trackUsage, getUsageSummary };
