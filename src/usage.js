const fs = require('fs');
const path = require('path');

const USAGE_FILE = path.join(__dirname, '..', 'usage.json');

// Pricing per million tokens (USD) — Claude Sonnet 4 / Opus 4
const PRICING = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
};

const DEFAULT_PRICING = { input: 3, output: 15 };

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { calls: [], totals: { inputTokens: 0, outputTokens: 0, costUSD: 0 } };
  }
}

function saveUsage(data) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
}

function trackUsage({ model, inputTokens, outputTokens, tool, clientId, clientName }) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const costUSD = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

  const entry = {
    timestamp: new Date().toISOString(),
    model,
    inputTokens,
    outputTokens,
    costUSD: Math.round(costUSD * 1_000_000) / 1_000_000, // 6 decimal places
    tool,
    clientId: clientId || null,
    clientName: clientName || null,
  };

  const data = loadUsage();
  data.calls.push(entry);
  data.totals.inputTokens += inputTokens;
  data.totals.outputTokens += outputTokens;
  data.totals.costUSD = Math.round((data.totals.costUSD + costUSD) * 1_000_000) / 1_000_000;
  saveUsage(data);

  return entry;
}

function getUsageSummary() {
  const data = loadUsage();
  const calls = data.calls;

  // Per tool
  const byTool = {};
  // Per client
  const byClient = {};
  // Per day (last 30 days)
  const byDay = {};

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (const call of calls) {
    // By tool
    if (!byTool[call.tool]) byTool[call.tool] = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
    byTool[call.tool].calls++;
    byTool[call.tool].inputTokens += call.inputTokens;
    byTool[call.tool].outputTokens += call.outputTokens;
    byTool[call.tool].costUSD += call.costUSD;

    // By client
    const cName = call.clientName || 'Unknown';
    if (!byClient[cName]) byClient[cName] = { calls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 };
    byClient[cName].calls++;
    byClient[cName].inputTokens += call.inputTokens;
    byClient[cName].outputTokens += call.outputTokens;
    byClient[cName].costUSD += call.costUSD;

    // By day (last 30 days)
    const date = call.timestamp.slice(0, 10);
    if (new Date(date) >= thirtyDaysAgo) {
      if (!byDay[date]) byDay[date] = { calls: 0, costUSD: 0 };
      byDay[date].calls++;
      byDay[date].costUSD += call.costUSD;
    }
  }

  // Round costs
  for (const k of Object.keys(byTool)) byTool[k].costUSD = Math.round(byTool[k].costUSD * 100) / 100;
  for (const k of Object.keys(byClient)) byClient[k].costUSD = Math.round(byClient[k].costUSD * 100) / 100;
  for (const k of Object.keys(byDay)) byDay[k].costUSD = Math.round(byDay[k].costUSD * 1000) / 1000;

  return {
    total: {
      calls: calls.length,
      inputTokens: data.totals.inputTokens,
      outputTokens: data.totals.outputTokens,
      costUSD: Math.round(data.totals.costUSD * 100) / 100,
    },
    byTool,
    byClient,
    byDay,
  };
}

module.exports = { trackUsage, getUsageSummary };
