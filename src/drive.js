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
    rowIndex: index + 1, // 1-based after header, so sheet row = rowIndex + 1
    item: row[0] || '',
    done: (row[1] || '').toLowerCase() === 'yes',
  })).filter(r => r.item);

  const nextItem = dataRows.find(r => !r.done) || null;

  return { rows: dataRows, nextItem };
}

async function saveContentToDoc(folderId, title, content) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // Create the document
  const doc = await docs.documents.create({
    requestBody: { title },
  });

  const docId = doc.data.documentId;

  // Insert content as plain text
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content,
          },
        },
      ],
    },
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

async function markTrackingItemDone(sheetId, rowIndex) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  // rowIndex is 1-based after header, sheet row = rowIndex + 1
  const sheetRow = rowIndex + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `B${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Yes']] },
  });
}

async function getRecentDocSamples(folderId, count = 2) {
  const auth = getAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  // Get recent Google Docs only (not sheets, slides, zip files etc)
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
      // Extract plain text from the doc body
      const text = (doc.data.body.content || [])
        .flatMap(el => el.paragraph ? el.paragraph.elements || [] : [])
        .map(el => el.textRun ? el.textRun.content : '')
        .join('')
        .trim()
        .slice(0, 3000); // Cap at 3000 chars per doc to keep token usage reasonable

      if (text) samples.push({ name: file.name, text });
    } catch (e) {
      // Skip docs we can't read
    }
  }

  return samples;
}

module.exports = { listClientDocs, getTrackingSheetData, saveContentToDoc, markTrackingItemDone, getRecentDocSamples };
