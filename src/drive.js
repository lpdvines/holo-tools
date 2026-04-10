const { google } = require('googleapis');

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

async function listClientDocs(folderId) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink, createdTime, mimeType)',
    orderBy: 'createdTime desc',
    pageSize: 50,
  });

  return res.data.files || [];
}

async function getTrackingSheetData(sheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A:B',
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return { rows: [], nextItem: null };

  const dataRows = rows.slice(1).map((row, index) => ({
    rowIndex: index + 1,
    item: row[0] || '',
    done: (row[1] || '').toLowerCase() === 'yes',
  })).filter(r => r.item);

  const nextItem = dataRows.find(r => !r.done) || null;

  return { rows: dataRows, nextItem };
}

// Parse markdown-ish content into segments for formatting
function parseContentSegments(content) {
  const lines = content.split('\n');
  const segments = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      segments.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (line.startsWith('# ')) {
      segments.push({ type: 'h1', text: line.slice(2).trim() });
    } else {
      segments.push({ type: 'body', text: line });
    }
  }

  return segments;
}

// Convert sentence to sentence case
function toSentenceCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
    .replace(/\bi\b/g, 'I')
    .replace(/\b(uk|seo|vat)\b/gi, m => m.toUpperCase());
}

async function saveFormattedDoc(folderId, title, contentBlocks) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // Create the document
  const doc = await docs.documents.create({
    requestBody: { title },
  });

  const docId = doc.data.documentId;

  // Build the full text and track ranges for formatting
  let fullText = '';
  const formatRanges = [];

  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i];

    if (block.type === 'page-title') {
      const startIdx = fullText.length + 1; // +1 for doc index offset
      fullText += block.text + '\n\n';
      formatRanges.push({
        start: startIdx,
        end: startIdx + block.text.length,
        bold: true,
        fontSize: 14,
      });
    } else if (block.type === 'separator') {
      fullText += '\n\n' + block.text + '\n\n\n';
    } else {
      // Parse content into segments
      const segments = parseContentSegments(block.text);
      for (const seg of segments) {
        const startIdx = fullText.length + 1;
        fullText += seg.text + '\n';

        if (seg.type === 'h1') {
          formatRanges.push({
            start: startIdx,
            end: startIdx + seg.text.length,
            bold: true,
            fontSize: 14,
          });
        } else if (seg.type === 'h2') {
          formatRanges.push({
            start: startIdx,
            end: startIdx + seg.text.length,
            bold: true,
            fontSize: 12,
          });
        } else {
          formatRanges.push({
            start: startIdx,
            end: startIdx + seg.text.length,
            bold: false,
            fontSize: 11,
          });
        }
      }
    }
  }

  // Insert all text first
  const requests = [
    {
      insertText: {
        location: { index: 1 },
        text: fullText,
      },
    },
  ];

  // Apply formatting
  for (const range of formatRanges) {
    if (range.end <= range.start) continue;
    requests.push({
      updateTextStyle: {
        range: { startIndex: range.start, endIndex: range.end },
        textStyle: {
          bold: range.bold,
          fontSize: { magnitude: range.fontSize, unit: 'PT' },
        },
        fields: 'bold,fontSize',
      },
    });
  }

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  // Move to client folder
  const file = await drive.files.get({ fileId: docId, fields: 'parents' });
  const previousParents = (file.data.parents || []).join(',');

  await drive.files.update({
    fileId: docId,
    addParents: folderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });

  return {
    docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`,
    title,
  };
}

async function saveContentToDoc(folderId, title, content) {
  const contentBlocks = [{ type: 'content', text: content }];
  return saveFormattedDoc(folderId, title, contentBlocks);
}

async function saveBatchContentToDoc(folderId, title, pages) {
  const contentBlocks = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    // Page title in sentence case, bold, 14pt
    const pageTitle = p.subject || p.pageTitle || 'Untitled';
    contentBlocks.push({ type: 'page-title', text: pageTitle });
    contentBlocks.push({ type: 'content', text: p.content });

    if (i < pages.length - 1) {
      contentBlocks.push({ type: 'separator', text: '───────────────────────────────────────' });
    }
  }

  return saveFormattedDoc(folderId, title, contentBlocks);
}

async function markTrackingItemDone(sheetId, rowIndex) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetRow = rowIndex + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `B${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Yes']] },
  });
}

async function addTrackingEntry(sheetId, itemName, docUrl) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'A:D',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[itemName, 'Yes', new Date().toISOString().slice(0, 10), docUrl]],
    },
  });
}

async function createTrackingSheet(folderId, clientName) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  // Create the spreadsheet
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${clientName} - Content Tracker` },
      sheets: [{
        properties: { title: 'Tracker' },
      }],
    },
  });

  const sheetId = spreadsheet.data.spreadsheetId;

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'A1:D1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Location/Topic', 'Done', 'Date Created', 'Doc Link']],
    },
  });

  // Bold the header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      }],
    },
  });

  // Move to client folder
  const file = await drive.files.get({ fileId: sheetId, fields: 'parents' });
  const previousParents = (file.data.parents || []).join(',');

  await drive.files.update({
    fileId: sheetId,
    addParents: folderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });

  return {
    sheetId,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
  };
}

async function getRecentDocSamples(folderId, count = 2) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'`,
    fields: 'files(id, name)',
    orderBy: 'createdTime desc',
    pageSize: count,
  });

  const files = res.data.files || [];
  const samples = [];

  for (const file of files) {
    try {
      const doc = await docs.documents.get({ documentId: file.id });
      const text = (doc.data.body.content || [])
        .flatMap(el => el.paragraph ? el.paragraph.elements || [] : [])
        .map(el => el.textRun ? el.textRun.content : '')
        .join('')
        .trim()
        .slice(0, 3000);

      if (text) samples.push({ name: file.name, text });
    } catch (e) {
      // Skip docs we can't read
    }
  }

  return samples;
}

module.exports = {
  listClientDocs,
  getTrackingSheetData,
  saveContentToDoc,
  saveBatchContentToDoc,
  markTrackingItemDone,
  addTrackingEntry,
  createTrackingSheet,
  getRecentDocSamples,
};
