require('dotenv').config();
const express = require('express');
const path = require('path');
const { generateAdsCopy, generateContent, generateBlogIdeas, generateGBPPost } = require('./src/claude');
const { listClientDocs, getTrackingSheetData, saveContentToDoc, saveBatchContentToDoc, markTrackingItemDone, addTrackingEntry, createTrackingSheet, getRecentDocSamples } = require('./src/drive');
const { listAccounts, listLocations, publishPost } = require('./src/gbp');
const { getTopQueries, getTopPages: getGSCTopPages, getQueriesForPage, listSites } = require('./src/gsc');
const { getOverview, getTopPages: getGA4TopPages, getTrafficSources, getDailySessions, listProperties } = require('./src/analytics');
const { getLeads, getAccountReports } = require('./src/lsa');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Dev proxy — when REMOTE_API_URL is set, forward all /api/* to remote server
if (process.env.REMOTE_API_URL) {
  const { createProxyMiddleware } = require('./src/proxy');
  app.use(createProxyMiddleware(process.env.REMOTE_API_URL));
  console.log(`Dev proxy active → ${process.env.REMOTE_API_URL}`);
}

function findClient(clientId) {
  const client = db.getClient(clientId);
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
  return client;
}

// ── Clients ──────────────────────────────────────────────────────────────────

app.get('/api/clients', (req, res) => {
  try {
    res.json(db.getAllClients());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

app.get('/api/clients/:clientId', (req, res) => {
  try {
    res.json(findClient(req.params.clientId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/clients', (req, res) => {
  try {
    const data = req.body;
    if (!data.id) {
      data.id = (data.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    if (db.getClient(data.id)) {
      return res.status(400).json({ error: 'A client with this ID already exists' });
    }
    res.json(db.createClient(data));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create client' });
  }
});

app.put('/api/clients/:clientId', (req, res) => {
  try {
    const updated = db.updateClient(req.params.clientId, req.body);
    if (!updated) return res.status(404).json({ error: 'Client not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update client' });
  }
});

app.delete('/api/clients/:clientId', (req, res) => {
  try {
    const result = db.deleteClient(req.params.clientId);
    if (!result.changes) return res.status(404).json({ error: 'Client not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete client' });
  }
});

// ── Usage ─────────────────────────────────────────────────────────────────────

app.get('/api/usage', (req, res) => {
  try {
    res.json(db.getUsageStats());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load usage data' });
  }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────

app.get('/api/roadmap', (req, res) => {
  res.json(db.getAllRoadmapItems());
});

app.put('/api/roadmap', (req, res) => {
  db.saveAllRoadmapItems(req.body);
  res.json({ success: true });
});

// ── Google Ads Copy ───────────────────────────────────────────────────────────

app.post('/api/generate/ads', async (req, res) => {
  const { clientId, service, location, notes } = req.body;
  if (!clientId || !service || !location) {
    return res.status(400).json({ error: 'clientId, service and location are required' });
  }
  try {
    const clientData = findClient(clientId);
    const result = await generateAdsCopy({ clientData, service, location, notes });
    res.json(result);
  } catch (err) {
    console.error('Ads generation error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate ads copy' });
  }
});

// ── Drive: list client docs ───────────────────────────────────────────────────

app.get('/api/drive/files/:clientId', async (req, res) => {
  try {
    const clientData = findClient(req.params.clientId);
    if (!clientData.googleDriveFolderId) return res.json({ files: [], hasFolder: false });
    const files = await listClientDocs(clientData.googleDriveFolderId);
    res.json({ files, hasFolder: true });
  } catch (err) {
    console.error('Drive files error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to list Drive files' });
  }
});

// ── Drive: get tracking sheet ─────────────────────────────────────────────────

app.get('/api/drive/tracking/:clientId', async (req, res) => {
  try {
    const clientData = findClient(req.params.clientId);
    if (!clientData.googleTrackingSheetId) return res.json({ hasSheet: false, rows: [], nextItem: null });
    const data = await getTrackingSheetData(clientData.googleTrackingSheetId);
    const batchSize = clientData.batchSize || 1;
    const nextItems = data.rows.filter(r => !r.done).slice(0, batchSize);
    res.json({ hasSheet: true, ...data, nextItems, batchSize });
  } catch (err) {
    console.error('Tracking sheet error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to read tracking sheet' });
  }
});

// ── Blog Ideas ────────────────────────────────────────────────────────────────

app.post('/api/generate/blog-ideas', async (req, res) => {
  const { clientId, count } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  try {
    const clientData = findClient(clientId);
    let existingTitles = [];
    if (clientData.googleDriveFolderId) {
      const files = await listClientDocs(clientData.googleDriveFolderId);
      existingTitles = files.map(f => f.name);
    }
    const result = await generateBlogIdeas({ clientData, count: count || 8, existingTitles });
    res.json(result);
  } catch (err) {
    console.error('Blog ideas error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate blog ideas' });
  }
});

// ── Content Generator ─────────────────────────────────────────────────────────

app.post('/api/generate/content', async (req, res) => {
  const { clientId, contentType, subject } = req.body;
  if (!clientId || !contentType || !subject) {
    return res.status(400).json({ error: 'clientId, contentType and subject are required' });
  }
  try {
    const clientData = findClient(clientId);
    let existingTitles = [];
    let docSamples = [];
    if (clientData.googleDriveFolderId) {
      const [files, samples] = await Promise.all([
        listClientDocs(clientData.googleDriveFolderId),
        getRecentDocSamples(clientData.googleDriveFolderId, 2),
      ]);
      existingTitles = files.map(f => f.name);
      docSamples = samples;
    }
    const result = await generateContent({ clientData, contentType, subject, existingTitles, docSamples });
    res.json(result);
  } catch (err) {
    console.error('Content generation error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate content' });
  }
});

// ── Drive: save single content doc ────────────────────────────────────────────

app.post('/api/drive/save', async (req, res) => {
  const { clientId, title, content, trackingRowIndex } = req.body;
  if (!clientId || !title || !content) {
    return res.status(400).json({ error: 'clientId, title and content are required' });
  }
  try {
    const clientData = findClient(clientId);
    if (!clientData.googleDriveFolderId) {
      return res.status(400).json({ error: 'This client has no Drive folder configured' });
    }
    const doc = await saveContentToDoc(clientData.googleDriveFolderId, title, content);
    if (trackingRowIndex != null && clientData.googleTrackingSheetId) {
      await markTrackingItemDone(clientData.googleTrackingSheetId, trackingRowIndex);
    }
    let sheetId = clientData.googleTrackingSheetId;
    if (!sheetId) {
      const sheet = await createTrackingSheet(clientData.googleDriveFolderId, clientData.name);
      sheetId = sheet.sheetId;
      db.updateClientField(clientId, 'googleTrackingSheetId', sheetId);
    }
    if (sheetId && trackingRowIndex == null) {
      await addTrackingEntry(sheetId, title, doc.docUrl);
    }
    res.json({ success: true, ...doc });
  } catch (err) {
    console.error('Save to Drive error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to save to Drive' });
  }
});

// ── Drive: save batch content doc ─────────────────────────────────────────────

app.post('/api/drive/save/batch', async (req, res) => {
  const { clientId, title, pages, trackingRowIndexes } = req.body;
  if (!clientId || !title || !pages || !pages.length) {
    return res.status(400).json({ error: 'clientId, title and pages[] are required' });
  }
  try {
    const clientData = findClient(clientId);
    if (!clientData.googleDriveFolderId) {
      return res.status(400).json({ error: 'This client has no Drive folder configured' });
    }
    const doc = await saveBatchContentToDoc(clientData.googleDriveFolderId, title, pages);
    if (trackingRowIndexes && trackingRowIndexes.length && clientData.googleTrackingSheetId) {
      for (const rowIndex of trackingRowIndexes) {
        await markTrackingItemDone(clientData.googleTrackingSheetId, rowIndex);
      }
    }
    let sheetId = clientData.googleTrackingSheetId;
    if (!sheetId) {
      const sheet = await createTrackingSheet(clientData.googleDriveFolderId, clientData.name);
      sheetId = sheet.sheetId;
      db.updateClientField(clientId, 'googleTrackingSheetId', sheetId);
    }
    if (sheetId && (!trackingRowIndexes || !trackingRowIndexes.length)) {
      for (const page of pages) {
        const itemName = page.subject || page.pageTitle || 'Untitled';
        await addTrackingEntry(sheetId, itemName, doc.docUrl);
      }
    }
    res.json({ success: true, ...doc });
  } catch (err) {
    console.error('Batch save error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to save batch to Drive' });
  }
});

// ── GBP Posts ────────────────────────────────────────────────────────────────

app.get('/api/gbp/posts', (req, res) => {
  res.json(db.getAllGBPPosts({ clientId: req.query.clientId, status: req.query.status }));
});

app.post('/api/gbp/generate', async (req, res) => {
  const { clientId, postType, topic, notes } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  try {
    const clientData = findClient(clientId);
    const result = await generateGBPPost({ clientData, postType: postType || 'STANDARD', topic, notes });
    const post = db.createGBPPost({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      clientId,
      clientName: clientData.name,
      postType: postType || 'STANDARD',
      summary: result.summary,
      callToAction: result.callToAction,
      imageSuggestion: result.imageSuggestion,
      postTitle: result.postTitle,
      status: 'draft',
      scheduledAt: null,
      publishedAt: null,
      gbpAccountId: clientData.gbpAccountId || '',
      gbpLocationId: clientData.gbpLocationId || '',
      createdAt: new Date().toISOString(),
    });
    res.json(post);
  } catch (err) {
    console.error('GBP generate error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate GBP post' });
  }
});

app.put('/api/gbp/posts/:postId', (req, res) => {
  const post = db.updateGBPPost(req.params.postId, req.body);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

app.delete('/api/gbp/posts/:postId', (req, res) => {
  db.deleteGBPPost(req.params.postId);
  res.json({ success: true });
});

app.post('/api/gbp/posts/:postId/publish', async (req, res) => {
  const post = db.getGBPPost(req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (!post.gbpAccountId || !post.gbpLocationId) {
    return res.status(400).json({ error: 'No GBP account/location configured. Set them on the client first.' });
  }
  try {
    await publishPost(post.gbpAccountId, post.gbpLocationId, {
      summary: post.summary,
      topicType: post.postType,
      callToAction: post.callToAction ? {
        actionType: post.callToAction.actionType,
        url: post.callToAction.suggestedUrl || post.callToAction.url,
      } : undefined,
    });
    const updated = db.updateGBPPost(post.id, { status: 'published', publishedAt: new Date().toISOString() });
    res.json(updated);
  } catch (err) {
    console.error('GBP publish error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to publish to GBP' });
  }
});

app.get('/api/gbp/accounts', async (req, res) => {
  try { res.json(await listAccounts()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gbp/accounts/:accountName/locations', async (req, res) => {
  try { res.json(await listLocations(req.params.accountName)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Google Search Console ────────────────────────────────────────────────────

app.get('/api/gsc/sites', async (req, res) => {
  try { res.json(await listSites()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gsc/queries/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) return res.status(400).json({ error: 'No Search Console site URL configured' });
    const { startDate, endDate, limit } = req.query;
    res.json(await getTopQueries(client.searchConsoleSiteUrl, startDate, endDate, parseInt(limit) || 50));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/gsc/pages/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) return res.status(400).json({ error: 'No Search Console site URL configured' });
    const { startDate, endDate, limit } = req.query;
    res.json(await getGSCTopPages(client.searchConsoleSiteUrl, startDate, endDate, parseInt(limit) || 50));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/gsc/page-queries/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) return res.status(400).json({ error: 'No Search Console site URL configured' });
    const { pageUrl, startDate, endDate } = req.query;
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl query param required' });
    res.json(await getQueriesForPage(client.searchConsoleSiteUrl, pageUrl, startDate, endDate));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Google Analytics (GA4) ──────────────────────────────────────────────────

app.get('/api/ga4/properties', async (req, res) => {
  try { res.json(await listProperties()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ga4/overview/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) return res.status(400).json({ error: 'No GA4 property ID configured' });
    res.json(await getOverview(client.ga4PropertyId, req.query.startDate, req.query.endDate));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/ga4/pages/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) return res.status(400).json({ error: 'No GA4 property ID configured' });
    res.json(await getGA4TopPages(client.ga4PropertyId, req.query.startDate, req.query.endDate, parseInt(req.query.limit) || 30));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/ga4/sources/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) return res.status(400).json({ error: 'No GA4 property ID configured' });
    res.json(await getTrafficSources(client.ga4PropertyId, req.query.startDate, req.query.endDate));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/ga4/daily/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) return res.status(400).json({ error: 'No GA4 property ID configured' });
    res.json(await getDailySessions(client.ga4PropertyId, req.query.startDate, req.query.endDate));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Local Service Ads ───────────────────────────────────────────────────────

app.get('/api/lsa/leads', async (req, res) => {
  try {
    const { startDate, endDate, query } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
    res.json(await getLeads(startDate, endDate, query));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/lsa/accounts', async (req, res) => {
  try {
    const start = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const end = req.query.endDate || new Date().toISOString().slice(0, 10);
    res.json(await getAccountReports(start, end));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GBP Scheduler (check every minute for posts due to publish) ──────────

setInterval(async () => {
  const posts = db.getScheduledGBPPosts();
  const now = new Date();

  for (const post of posts) {
    if (new Date(post.scheduledAt) <= now) {
      if (!post.gbpAccountId || !post.gbpLocationId) {
        console.warn(`GBP post ${post.id} scheduled but no account/location — skipping`);
        continue;
      }
      try {
        await publishPost(post.gbpAccountId, post.gbpLocationId, {
          summary: post.summary,
          topicType: post.postType,
          callToAction: post.callToAction ? {
            actionType: post.callToAction.actionType,
            url: post.callToAction.suggestedUrl || post.callToAction.url,
          } : undefined,
        });
        db.updateGBPPost(post.id, { status: 'published', publishedAt: new Date().toISOString() });
        console.log(`GBP post ${post.id} published successfully`);
      } catch (err) {
        console.error(`GBP post ${post.id} failed:`, err.message);
        db.updateGBPPost(post.id, { status: 'failed', error: err.message });
      }
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`HOLO Tools running at http://localhost:${PORT}`);
});
