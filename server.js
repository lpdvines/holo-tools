require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateAdsCopy, generateContent, generateBlogIdeas, generateGBPPost } = require('./src/claude');
const { listClientDocs, getTrackingSheetData, saveContentToDoc, saveBatchContentToDoc, markTrackingItemDone, addTrackingEntry, createTrackingSheet, getRecentDocSamples } = require('./src/drive');
const { getUsageSummary } = require('./src/usage');
const { listAccounts, listLocations, publishPost } = require('./src/gbp');
const { getTopQueries, getTopPages: getGSCTopPages, getQueriesForPage, listSites } = require('./src/gsc');
const { getOverview, getTopPages: getGA4TopPages, getTrafficSources, getDailySessions, listProperties } = require('./src/analytics');
const { getLeads, getAccountReports } = require('./src/lsa');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadClients() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'clients.json'), 'utf8'));
}

function saveClients(clients) {
  fs.writeFileSync(path.join(__dirname, 'clients.json'), JSON.stringify(clients, null, 2));
}

function findClient(clientId) {
  const client = loadClients().find(c => c.id === clientId);
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
  return client;
}

function updateClientField(clientId, field, value) {
  const clients = loadClients();
  const client = clients.find(c => c.id === clientId);
  if (client) {
    client[field] = value;
    saveClients(clients);
  }
}

// ── Clients ──────────────────────────────────────────────────────────────────

app.get('/api/clients', (req, res) => {
  try {
    res.json(loadClients());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

// ── Client management ────────────────────────────────────────────────────────

app.get('/api/clients/:clientId', (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    res.json(client);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/clients', (req, res) => {
  try {
    const clients = loadClients();
    const data = req.body;

    // Generate ID from name
    if (!data.id) {
      data.id = (data.name || 'client')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    // Check for duplicate
    if (clients.find(c => c.id === data.id)) {
      return res.status(400).json({ error: 'A client with this ID already exists' });
    }

    // Set defaults for missing fields
    const newClient = {
      id: data.id,
      name: data.name || '',
      website: data.website || '',
      industry: data.industry || '',
      toneOfVoice: data.toneOfVoice || '',
      services: data.services || [],
      defaultService: data.defaultService || '',
      defaultContentType: data.defaultContentType || 'location',
      batchSize: data.batchSize || 4,
      docNameFormat: data.docNameFormat || '{name} - Content {monthYear}',
      targetLocations: data.targetLocations || [],
      avoidPhrases: data.avoidPhrases || [],
      keyMessages: data.keyMessages || [],
      servicesWeProvide: data.servicesWeProvide || [],
      monthlySpend: data.monthlySpend || '',
      contactName: data.contactName || '',
      contactEmail: data.contactEmail || '',
      contactPhone: data.contactPhone || '',
      notes: data.notes || '',
      internalLinks: data.internalLinks || [],
      googleDriveFolderId: data.googleDriveFolderId || '',
      googleTrackingSheetId: data.googleTrackingSheetId || '',
      googleAdsCustomerId: data.googleAdsCustomerId || '',
      gbpAccountId: data.gbpAccountId || '',
      gbpLocationId: data.gbpLocationId || '',
      facebookPageId: data.facebookPageId || '',
      trelloBoardId: data.trelloBoardId || '',
      trelloListId: data.trelloListId || '',
      trelloVaAssigneeId: data.trelloVaAssigneeId || '',
    };

    clients.push(newClient);
    saveClients(clients);
    res.json(newClient);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create client' });
  }
});

app.put('/api/clients/:clientId', (req, res) => {
  try {
    const clients = loadClients();
    const idx = clients.findIndex(c => c.id === req.params.clientId);
    if (idx === -1) return res.status(404).json({ error: 'Client not found' });

    // Merge updates
    const updated = { ...clients[idx], ...req.body };
    updated.id = clients[idx].id; // prevent ID change
    clients[idx] = updated;
    saveClients(clients);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to update client' });
  }
});

app.delete('/api/clients/:clientId', (req, res) => {
  try {
    let clients = loadClients();
    const before = clients.length;
    clients = clients.filter(c => c.id !== req.params.clientId);
    if (clients.length === before) return res.status(404).json({ error: 'Client not found' });
    saveClients(clients);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to delete client' });
  }
});

// ── Usage ─────────────────────────────────────────────────────────────────────

app.get('/api/usage', (req, res) => {
  try {
    res.json(getUsageSummary());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load usage data' });
  }
});

// ── Roadmap ───────────────────────────────────────────────────────────────────

const ROADMAP_FILE = path.join(__dirname, 'roadmap.json');

function loadRoadmap() {
  try {
    return JSON.parse(fs.readFileSync(ROADMAP_FILE, 'utf8'));
  } catch {
    return [];
  }
}

app.get('/api/roadmap', (req, res) => {
  res.json(loadRoadmap());
});

app.put('/api/roadmap', (req, res) => {
  fs.writeFileSync(ROADMAP_FILE, JSON.stringify(req.body, null, 2));
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
    if (!clientData.googleDriveFolderId) {
      return res.json({ files: [], hasFolder: false });
    }
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
    if (!clientData.googleTrackingSheetId) {
      return res.json({ hasSheet: false, rows: [], nextItem: null });
    }
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
  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }
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

    // Mark tracking sheet row as done if provided
    if (trackingRowIndex != null && clientData.googleTrackingSheetId) {
      await markTrackingItemDone(clientData.googleTrackingSheetId, trackingRowIndex);
    }

    // Auto-create tracking sheet if client doesn't have one
    let sheetId = clientData.googleTrackingSheetId;
    if (!sheetId) {
      const sheet = await createTrackingSheet(clientData.googleDriveFolderId, clientData.name);
      sheetId = sheet.sheetId;
      updateClientField(clientId, 'googleTrackingSheetId', sheetId);
    }

    // Add entry to tracking sheet
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

    // Mark tracking rows as done
    if (trackingRowIndexes && trackingRowIndexes.length && clientData.googleTrackingSheetId) {
      for (const rowIndex of trackingRowIndexes) {
        await markTrackingItemDone(clientData.googleTrackingSheetId, rowIndex);
      }
    }

    // Auto-create tracking sheet if client doesn't have one
    let sheetId = clientData.googleTrackingSheetId;
    if (!sheetId) {
      const sheet = await createTrackingSheet(clientData.googleDriveFolderId, clientData.name);
      sheetId = sheet.sheetId;
      updateClientField(clientId, 'googleTrackingSheetId', sheetId);
    }

    // Add entries for pages that weren't from the tracking sheet
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

const GBP_POSTS_FILE = path.join(__dirname, 'gbp-posts.json');

function loadGBPPosts() {
  try {
    return JSON.parse(fs.readFileSync(GBP_POSTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveGBPPosts(posts) {
  fs.writeFileSync(GBP_POSTS_FILE, JSON.stringify(posts, null, 2));
}

// List all GBP posts (optionally filter by clientId or status)
app.get('/api/gbp/posts', (req, res) => {
  let posts = loadGBPPosts();
  if (req.query.clientId) posts = posts.filter(p => p.clientId === req.query.clientId);
  if (req.query.status) posts = posts.filter(p => p.status === req.query.status);
  // Sort: newest first
  posts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(posts);
});

// Generate a GBP post via Claude
app.post('/api/gbp/generate', async (req, res) => {
  const { clientId, postType, topic, notes } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }
  try {
    const clientData = findClient(clientId);
    const result = await generateGBPPost({ clientData, postType: postType || 'STANDARD', topic, notes });

    // Save as draft
    const post = {
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
      gbpAccountId: clientData.gbpAccountId || null,
      gbpLocationId: clientData.gbpLocationId || null,
      createdAt: new Date().toISOString(),
    };

    const posts = loadGBPPosts();
    posts.push(post);
    saveGBPPosts(posts);

    res.json(post);
  } catch (err) {
    console.error('GBP generate error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate GBP post' });
  }
});

// Update a GBP post (edit text, approve, schedule, reject)
app.put('/api/gbp/posts/:postId', (req, res) => {
  const posts = loadGBPPosts();
  const post = posts.find(p => p.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { summary, callToAction, status, scheduledAt, postTitle } = req.body;
  if (summary !== undefined) post.summary = summary.slice(0, 1500);
  if (callToAction !== undefined) post.callToAction = callToAction;
  if (postTitle !== undefined) post.postTitle = postTitle;
  if (status !== undefined) post.status = status;
  if (scheduledAt !== undefined) post.scheduledAt = scheduledAt;

  saveGBPPosts(posts);
  res.json(post);
});

// Delete a GBP post
app.delete('/api/gbp/posts/:postId', (req, res) => {
  let posts = loadGBPPosts();
  posts = posts.filter(p => p.id !== req.params.postId);
  saveGBPPosts(posts);
  res.json({ success: true });
});

// Publish a GBP post immediately
app.post('/api/gbp/posts/:postId/publish', async (req, res) => {
  const posts = loadGBPPosts();
  const post = posts.find(p => p.id === req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  if (!post.gbpAccountId || !post.gbpLocationId) {
    return res.status(400).json({ error: 'This post has no GBP account/location configured. Set gbpAccountId and gbpLocationId on the client first.' });
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

    post.status = 'published';
    post.publishedAt = new Date().toISOString();
    saveGBPPosts(posts);

    res.json(post);
  } catch (err) {
    console.error('GBP publish error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to publish to GBP' });
  }
});

// List GBP accounts
app.get('/api/gbp/accounts', async (req, res) => {
  try {
    const accounts = await listAccounts();
    res.json(accounts);
  } catch (err) {
    console.error('GBP accounts error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list GBP accounts' });
  }
});

// List GBP locations for an account
app.get('/api/gbp/accounts/:accountName/locations', async (req, res) => {
  try {
    const locations = await listLocations(req.params.accountName);
    res.json(locations);
  } catch (err) {
    console.error('GBP locations error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list GBP locations' });
  }
});

// ── Google Search Console ────────────────────────────────────────────────────

app.get('/api/gsc/sites', async (req, res) => {
  try {
    const sites = await listSites();
    res.json(sites);
  } catch (err) {
    console.error('GSC sites error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list Search Console sites' });
  }
});

app.get('/api/gsc/queries/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) {
      return res.status(400).json({ error: 'No Search Console site URL configured for this client' });
    }
    const { startDate, endDate, limit } = req.query;
    const data = await getTopQueries(client.searchConsoleSiteUrl, startDate, endDate, parseInt(limit) || 50);
    res.json(data);
  } catch (err) {
    console.error('GSC queries error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch search queries' });
  }
});

app.get('/api/gsc/pages/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) {
      return res.status(400).json({ error: 'No Search Console site URL configured for this client' });
    }
    const { startDate, endDate, limit } = req.query;
    const data = await getGSCTopPages(client.searchConsoleSiteUrl, startDate, endDate, parseInt(limit) || 50);
    res.json(data);
  } catch (err) {
    console.error('GSC pages error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch page data' });
  }
});

app.get('/api/gsc/page-queries/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.searchConsoleSiteUrl) {
      return res.status(400).json({ error: 'No Search Console site URL configured' });
    }
    const { pageUrl, startDate, endDate } = req.query;
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl query param required' });
    const data = await getQueriesForPage(client.searchConsoleSiteUrl, pageUrl, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('GSC page queries error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Google Analytics (GA4) ──────────────────────────────────────────────────

app.get('/api/ga4/properties', async (req, res) => {
  try {
    const properties = await listProperties();
    res.json(properties);
  } catch (err) {
    console.error('GA4 properties error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to list GA4 properties' });
  }
});

app.get('/api/ga4/overview/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) {
      return res.status(400).json({ error: 'No GA4 property ID configured for this client' });
    }
    const { startDate, endDate } = req.query;
    const data = await getOverview(client.ga4PropertyId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('GA4 overview error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch GA4 overview' });
  }
});

app.get('/api/ga4/pages/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) {
      return res.status(400).json({ error: 'No GA4 property ID configured' });
    }
    const { startDate, endDate, limit } = req.query;
    const data = await getGA4TopPages(client.ga4PropertyId, startDate, endDate, parseInt(limit) || 30);
    res.json(data);
  } catch (err) {
    console.error('GA4 pages error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/ga4/sources/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) {
      return res.status(400).json({ error: 'No GA4 property ID configured' });
    }
    const { startDate, endDate } = req.query;
    const data = await getTrafficSources(client.ga4PropertyId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('GA4 sources error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/ga4/daily/:clientId', async (req, res) => {
  try {
    const client = findClient(req.params.clientId);
    if (!client.ga4PropertyId) {
      return res.status(400).json({ error: 'No GA4 property ID configured' });
    }
    const { startDate, endDate } = req.query;
    const data = await getDailySessions(client.ga4PropertyId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('GA4 daily error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Local Service Ads ───────────────────────────────────────────────────────

app.get('/api/lsa/leads', async (req, res) => {
  try {
    const { startDate, endDate, query } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const data = await getLeads(startDate, endDate, query);
    res.json(data);
  } catch (err) {
    console.error('LSA leads error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch LSA leads' });
  }
});

app.get('/api/lsa/accounts', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);
    const data = await getAccountReports(start, end);
    res.json(data);
  } catch (err) {
    console.error('LSA accounts error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch LSA accounts' });
  }
});

// ── GBP Scheduler (check every minute for posts due to publish) ──────────

setInterval(async () => {
  const posts = loadGBPPosts();
  const now = new Date();
  let changed = false;

  for (const post of posts) {
    if (post.status === 'scheduled' && post.scheduledAt && new Date(post.scheduledAt) <= now) {
      if (!post.gbpAccountId || !post.gbpLocationId) {
        console.warn(`GBP post ${post.id} scheduled but no account/location configured — skipping`);
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
        post.status = 'published';
        post.publishedAt = new Date().toISOString();
        changed = true;
        console.log(`GBP post ${post.id} published successfully`);
      } catch (err) {
        console.error(`GBP post ${post.id} failed to publish:`, err.message);
        post.status = 'failed';
        post.error = err.message;
        changed = true;
      }
    }
  }

  if (changed) saveGBPPosts(posts);
}, 60 * 1000); // every minute

app.listen(PORT, () => {
  console.log(`HOLO Tools running at http://localhost:${PORT}`);
});
