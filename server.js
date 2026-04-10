require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateAdsCopy, generateContent, generateBlogIdeas } = require('./src/claude');
const { listClientDocs, getTrackingSheetData, saveContentToDoc, saveBatchContentToDoc, markTrackingItemDone, addTrackingEntry, createTrackingSheet, getRecentDocSamples } = require('./src/drive');
const { getUsageSummary } = require('./src/usage');

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

// ── Usage ─────────────────────────────────────────────────────────────────────

app.get('/api/usage', (req, res) => {
  try {
    res.json(getUsageSummary());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load usage data' });
  }
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

app.listen(PORT, () => {
  console.log(`HOLO Tools running at http://localhost:${PORT}`);
});
