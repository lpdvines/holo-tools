const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'holo.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    toneOfVoice TEXT DEFAULT '',
    services TEXT DEFAULT '[]',
    defaultService TEXT DEFAULT '',
    defaultContentType TEXT DEFAULT 'location',
    batchSize INTEGER DEFAULT 4,
    docNameFormat TEXT DEFAULT '{name} - Content {monthYear}',
    targetLocations TEXT DEFAULT '[]',
    avoidPhrases TEXT DEFAULT '[]',
    keyMessages TEXT DEFAULT '[]',
    internalLinks TEXT DEFAULT '[]',
    servicesWeProvide TEXT DEFAULT '[]',
    monthlySpend TEXT DEFAULT '',
    contactName TEXT DEFAULT '',
    contactEmail TEXT DEFAULT '',
    contactPhone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    googleDriveFolderId TEXT DEFAULT '',
    googleTrackingSheetId TEXT DEFAULT '',
    googleAdsCustomerId TEXT DEFAULT '',
    gbpAccountId TEXT DEFAULT '',
    gbpLocationId TEXT DEFAULT '',
    facebookPageId TEXT DEFAULT '',
    searchConsoleSiteUrl TEXT DEFAULT '',
    ga4PropertyId TEXT DEFAULT '',
    trelloBoardId TEXT DEFAULT '',
    trelloListId TEXT DEFAULT '',
    trelloVaAssigneeId TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roadmap_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'planned',
    createdAt TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS gbp_posts (
    id TEXT PRIMARY KEY,
    clientId TEXT DEFAULT '',
    clientName TEXT DEFAULT '',
    postType TEXT DEFAULT 'STANDARD',
    summary TEXT DEFAULT '',
    callToAction TEXT DEFAULT '{}',
    imageSuggestion TEXT DEFAULT '',
    postTitle TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    scheduledAt TEXT,
    publishedAt TEXT,
    gbpAccountId TEXT DEFAULT '',
    gbpLocationId TEXT DEFAULT '',
    error TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    model TEXT DEFAULT '',
    inputTokens INTEGER DEFAULT 0,
    outputTokens INTEGER DEFAULT 0,
    costUSD REAL DEFAULT 0,
    tool TEXT DEFAULT '',
    clientId TEXT DEFAULT '',
    clientName TEXT DEFAULT ''
  );
`);

// ── JSON array helpers ──────────────────────────────────────────────────────
// Columns like services, targetLocations etc are stored as JSON strings

function parseJsonCol(val) {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

function toJsonCol(arr) {
  return JSON.stringify(arr || []);
}

function parseJsonObj(val) {
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}

function toJsonObj(obj) {
  return JSON.stringify(obj || {});
}

// ── Clients ─────────────────────────────────────────────────────────────────

function clientRowToObj(row) {
  if (!row) return null;
  return {
    ...row,
    services: parseJsonCol(row.services),
    targetLocations: parseJsonCol(row.targetLocations),
    avoidPhrases: parseJsonCol(row.avoidPhrases),
    keyMessages: parseJsonCol(row.keyMessages),
    internalLinks: parseJsonCol(row.internalLinks),
    servicesWeProvide: parseJsonCol(row.servicesWeProvide),
  };
}

function getAllClients() {
  const rows = db.prepare('SELECT * FROM clients ORDER BY name').all();
  return rows.map(clientRowToObj);
}

function getClient(id) {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  return clientRowToObj(row);
}

function createClient(data) {
  const stmt = db.prepare(`
    INSERT INTO clients (id, name, website, industry, toneOfVoice, services, defaultService,
      defaultContentType, batchSize, docNameFormat, targetLocations, avoidPhrases, keyMessages,
      internalLinks, servicesWeProvide, monthlySpend, contactName, contactEmail, contactPhone,
      notes, googleDriveFolderId, googleTrackingSheetId, googleAdsCustomerId, gbpAccountId,
      gbpLocationId, facebookPageId, searchConsoleSiteUrl, ga4PropertyId, trelloBoardId,
      trelloListId, trelloVaAssigneeId)
    VALUES (@id, @name, @website, @industry, @toneOfVoice, @services, @defaultService,
      @defaultContentType, @batchSize, @docNameFormat, @targetLocations, @avoidPhrases, @keyMessages,
      @internalLinks, @servicesWeProvide, @monthlySpend, @contactName, @contactEmail, @contactPhone,
      @notes, @googleDriveFolderId, @googleTrackingSheetId, @googleAdsCustomerId, @gbpAccountId,
      @gbpLocationId, @facebookPageId, @searchConsoleSiteUrl, @ga4PropertyId, @trelloBoardId,
      @trelloListId, @trelloVaAssigneeId)
  `);

  const params = prepareClientParams(data);
  stmt.run(params);
  return getClient(params.id);
}

function updateClient(id, data) {
  const existing = getClient(id);
  if (!existing) return null;

  const merged = { ...existing, ...data, id }; // prevent ID change
  const params = prepareClientParams(merged);

  db.prepare(`
    UPDATE clients SET name=@name, website=@website, industry=@industry, toneOfVoice=@toneOfVoice,
      services=@services, defaultService=@defaultService, defaultContentType=@defaultContentType,
      batchSize=@batchSize, docNameFormat=@docNameFormat, targetLocations=@targetLocations,
      avoidPhrases=@avoidPhrases, keyMessages=@keyMessages, internalLinks=@internalLinks,
      servicesWeProvide=@servicesWeProvide, monthlySpend=@monthlySpend, contactName=@contactName,
      contactEmail=@contactEmail, contactPhone=@contactPhone, notes=@notes,
      googleDriveFolderId=@googleDriveFolderId, googleTrackingSheetId=@googleTrackingSheetId,
      googleAdsCustomerId=@googleAdsCustomerId, gbpAccountId=@gbpAccountId, gbpLocationId=@gbpLocationId,
      facebookPageId=@facebookPageId, searchConsoleSiteUrl=@searchConsoleSiteUrl, ga4PropertyId=@ga4PropertyId,
      trelloBoardId=@trelloBoardId, trelloListId=@trelloListId, trelloVaAssigneeId=@trelloVaAssigneeId
    WHERE id=@id
  `).run(params);

  return getClient(id);
}

function deleteClient(id) {
  return db.prepare('DELETE FROM clients WHERE id = ?').run(id);
}

function updateClientField(id, field, value) {
  // For simple field updates (e.g. tracking sheet ID)
  const allowed = ['googleTrackingSheetId', 'googleDriveFolderId', 'gbpAccountId', 'gbpLocationId',
    'searchConsoleSiteUrl', 'ga4PropertyId', 'googleAdsCustomerId', 'facebookPageId'];
  if (!allowed.includes(field)) return;
  db.prepare(`UPDATE clients SET ${field} = ? WHERE id = ?`).run(value, id);
}

function prepareClientParams(data) {
  return {
    id: data.id || '',
    name: data.name || '',
    website: data.website || '',
    industry: data.industry || '',
    toneOfVoice: data.toneOfVoice || '',
    services: Array.isArray(data.services) ? toJsonCol(data.services) : (data.services || '[]'),
    defaultService: data.defaultService || '',
    defaultContentType: data.defaultContentType || 'location',
    batchSize: data.batchSize || 4,
    docNameFormat: data.docNameFormat || '{name} - Content {monthYear}',
    targetLocations: Array.isArray(data.targetLocations) ? toJsonCol(data.targetLocations) : (data.targetLocations || '[]'),
    avoidPhrases: Array.isArray(data.avoidPhrases) ? toJsonCol(data.avoidPhrases) : (data.avoidPhrases || '[]'),
    keyMessages: Array.isArray(data.keyMessages) ? toJsonCol(data.keyMessages) : (data.keyMessages || '[]'),
    internalLinks: Array.isArray(data.internalLinks) ? toJsonCol(data.internalLinks) : (data.internalLinks || '[]'),
    servicesWeProvide: Array.isArray(data.servicesWeProvide) ? toJsonCol(data.servicesWeProvide) : (data.servicesWeProvide || '[]'),
    monthlySpend: data.monthlySpend || '',
    contactName: data.contactName || '',
    contactEmail: data.contactEmail || '',
    contactPhone: data.contactPhone || '',
    notes: data.notes || '',
    googleDriveFolderId: data.googleDriveFolderId || '',
    googleTrackingSheetId: data.googleTrackingSheetId || '',
    googleAdsCustomerId: data.googleAdsCustomerId || '',
    gbpAccountId: data.gbpAccountId || '',
    gbpLocationId: data.gbpLocationId || '',
    facebookPageId: data.facebookPageId || '',
    searchConsoleSiteUrl: data.searchConsoleSiteUrl || '',
    ga4PropertyId: data.ga4PropertyId || '',
    trelloBoardId: data.trelloBoardId || '',
    trelloListId: data.trelloListId || '',
    trelloVaAssigneeId: data.trelloVaAssigneeId || '',
  };
}

// ── Roadmap ─────────────────────────────────────────────────────────────────

function getAllRoadmapItems() {
  return db.prepare('SELECT * FROM roadmap_items').all();
}

function saveAllRoadmapItems(items) {
  const del = db.prepare('DELETE FROM roadmap_items');
  const ins = db.prepare(`
    INSERT INTO roadmap_items (id, title, description, priority, status, createdAt)
    VALUES (@id, @title, @description, @priority, @status, @createdAt)
  `);

  const transaction = db.transaction((items) => {
    del.run();
    for (const item of items) {
      ins.run({
        id: item.id || '',
        title: item.title || '',
        description: item.description || '',
        priority: item.priority || 'medium',
        status: item.status || 'planned',
        createdAt: item.createdAt || '',
      });
    }
  });

  transaction(items);
}

// ── GBP Posts ───────────────────────────────────────────────────────────────

function gbpRowToObj(row) {
  if (!row) return null;
  return {
    ...row,
    callToAction: parseJsonObj(row.callToAction),
  };
}

function getAllGBPPosts(filters = {}) {
  let sql = 'SELECT * FROM gbp_posts';
  const conditions = [];
  const params = {};

  if (filters.clientId) { conditions.push('clientId = @clientId'); params.clientId = filters.clientId; }
  if (filters.status) { conditions.push('status = @status'); params.status = filters.status; }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY createdAt DESC';

  return db.prepare(sql).all(params).map(gbpRowToObj);
}

function getGBPPost(id) {
  const row = db.prepare('SELECT * FROM gbp_posts WHERE id = ?').get(id);
  return gbpRowToObj(row);
}

function createGBPPost(data) {
  db.prepare(`
    INSERT INTO gbp_posts (id, clientId, clientName, postType, summary, callToAction,
      imageSuggestion, postTitle, status, scheduledAt, publishedAt, gbpAccountId, gbpLocationId, createdAt)
    VALUES (@id, @clientId, @clientName, @postType, @summary, @callToAction,
      @imageSuggestion, @postTitle, @status, @scheduledAt, @publishedAt, @gbpAccountId, @gbpLocationId, @createdAt)
  `).run({
    id: data.id,
    clientId: data.clientId || '',
    clientName: data.clientName || '',
    postType: data.postType || 'STANDARD',
    summary: data.summary || '',
    callToAction: toJsonObj(data.callToAction),
    imageSuggestion: data.imageSuggestion || '',
    postTitle: data.postTitle || '',
    status: data.status || 'draft',
    scheduledAt: data.scheduledAt || null,
    publishedAt: data.publishedAt || null,
    gbpAccountId: data.gbpAccountId || '',
    gbpLocationId: data.gbpLocationId || '',
    createdAt: data.createdAt || new Date().toISOString(),
  });
  return getGBPPost(data.id);
}

function updateGBPPost(id, data) {
  const existing = getGBPPost(id);
  if (!existing) return null;

  if (data.summary !== undefined) db.prepare('UPDATE gbp_posts SET summary = ? WHERE id = ?').run(data.summary.slice(0, 1500), id);
  if (data.callToAction !== undefined) db.prepare('UPDATE gbp_posts SET callToAction = ? WHERE id = ?').run(toJsonObj(data.callToAction), id);
  if (data.postTitle !== undefined) db.prepare('UPDATE gbp_posts SET postTitle = ? WHERE id = ?').run(data.postTitle, id);
  if (data.status !== undefined) db.prepare('UPDATE gbp_posts SET status = ? WHERE id = ?').run(data.status, id);
  if (data.scheduledAt !== undefined) db.prepare('UPDATE gbp_posts SET scheduledAt = ? WHERE id = ?').run(data.scheduledAt, id);
  if (data.publishedAt !== undefined) db.prepare('UPDATE gbp_posts SET publishedAt = ? WHERE id = ?').run(data.publishedAt, id);
  if (data.error !== undefined) db.prepare('UPDATE gbp_posts SET error = ? WHERE id = ?').run(data.error, id);

  return getGBPPost(id);
}

function deleteGBPPost(id) {
  return db.prepare('DELETE FROM gbp_posts WHERE id = ?').run(id);
}

function getScheduledGBPPosts() {
  return db.prepare("SELECT * FROM gbp_posts WHERE status = 'scheduled' AND scheduledAt IS NOT NULL")
    .all().map(gbpRowToObj);
}

// ── Usage ───────────────────────────────────────────────────────────────────

function logUsage(entry) {
  db.prepare(`
    INSERT INTO usage_logs (timestamp, model, inputTokens, outputTokens, costUSD, tool, clientId, clientName)
    VALUES (@timestamp, @model, @inputTokens, @outputTokens, @costUSD, @tool, @clientId, @clientName)
  `).run({
    timestamp: entry.timestamp || new Date().toISOString(),
    model: entry.model || '',
    inputTokens: entry.inputTokens || 0,
    outputTokens: entry.outputTokens || 0,
    costUSD: entry.costUSD || 0,
    tool: entry.tool || '',
    clientId: entry.clientId || '',
    clientName: entry.clientName || '',
  });
}

function getUsageStats() {
  const totals = db.prepare(`
    SELECT COUNT(*) as calls, COALESCE(SUM(inputTokens),0) as inputTokens,
      COALESCE(SUM(outputTokens),0) as outputTokens, COALESCE(SUM(costUSD),0) as costUSD
    FROM usage_logs
  `).get();

  const byTool = db.prepare(`
    SELECT tool, COUNT(*) as calls, SUM(inputTokens) as inputTokens,
      SUM(outputTokens) as outputTokens, SUM(costUSD) as costUSD
    FROM usage_logs GROUP BY tool
  `).all();

  const byClient = db.prepare(`
    SELECT clientName, COUNT(*) as calls, SUM(inputTokens) as inputTokens,
      SUM(outputTokens) as outputTokens, SUM(costUSD) as costUSD
    FROM usage_logs GROUP BY clientName ORDER BY costUSD DESC
  `).all();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const byDay = db.prepare(`
    SELECT substr(timestamp, 1, 10) as date, COUNT(*) as calls, SUM(costUSD) as costUSD
    FROM usage_logs WHERE timestamp >= ? GROUP BY date ORDER BY date
  `).all(thirtyDaysAgo.toISOString());

  // Format into the same shape the frontend expects
  const byToolObj = {};
  for (const row of byTool) {
    byToolObj[row.tool] = { calls: row.calls, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUSD: Math.round(row.costUSD * 100) / 100 };
  }

  const byClientObj = {};
  for (const row of byClient) {
    const name = row.clientName || 'Unknown';
    byClientObj[name] = { calls: row.calls, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUSD: Math.round(row.costUSD * 100) / 100 };
  }

  const byDayObj = {};
  for (const row of byDay) {
    byDayObj[row.date] = { calls: row.calls, costUSD: Math.round(row.costUSD * 1000) / 1000 };
  }

  return {
    total: {
      calls: totals.calls,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      costUSD: Math.round(totals.costUSD * 100) / 100,
    },
    byTool: byToolObj,
    byClient: byClientObj,
    byDay: byDayObj,
  };
}

module.exports = {
  db,
  // Clients
  getAllClients, getClient, createClient, updateClient, deleteClient, updateClientField,
  // Roadmap
  getAllRoadmapItems, saveAllRoadmapItems,
  // GBP Posts
  getAllGBPPosts, getGBPPost, createGBPPost, updateGBPPost, deleteGBPPost, getScheduledGBPPosts,
  // Usage
  logUsage, getUsageStats,
};
