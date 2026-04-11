const { google } = require('googleapis');

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

/**
 * Get search performance data from Google Search Console.
 * @param {string} siteUrl - The site URL as registered in GSC
 * @param {object} options - { startDate, endDate, dimensions, rowLimit }
 */
async function getSearchPerformance(siteUrl, options = {}) {
  const auth = getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const startDate = options.startDate || getDateDaysAgo(28);
  const endDate = options.endDate || getDateDaysAgo(1);
  const dimensions = options.dimensions || ['query'];
  const rowLimit = options.rowLimit || 50;

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      dataState: 'all',
    },
  });

  const rows = (res.data.rows || []).map(row => ({
    keys: row.keys,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100, // percentage with 2dp
    position: Math.round(row.position * 10) / 10,
  }));

  return {
    rows,
    startDate,
    endDate,
    responseAggregationType: res.data.responseAggregationType,
  };
}

/**
 * Get top queries for a site.
 */
async function getTopQueries(siteUrl, startDate, endDate, limit = 50) {
  return getSearchPerformance(siteUrl, {
    startDate,
    endDate,
    dimensions: ['query'],
    rowLimit: limit,
  });
}

/**
 * Get top pages for a site.
 */
async function getTopPages(siteUrl, startDate, endDate, limit = 50) {
  return getSearchPerformance(siteUrl, {
    startDate,
    endDate,
    dimensions: ['page'],
    rowLimit: limit,
  });
}

/**
 * Get queries for a specific page.
 */
async function getQueriesForPage(siteUrl, pageUrl, startDate, endDate, limit = 30) {
  const auth = getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startDate || getDateDaysAgo(28),
      endDate: endDate || getDateDaysAgo(1),
      dimensions: ['query'],
      dimensionFilterGroups: [{
        filters: [{ dimension: 'page', expression: pageUrl, operator: 'equals' }],
      }],
      rowLimit: limit,
      dataState: 'all',
    },
  });

  return (res.data.rows || []).map(row => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Math.round(row.ctr * 10000) / 100,
    position: Math.round(row.position * 10) / 10,
  }));
}

/**
 * List sites the user has access to in Search Console.
 */
async function listSites() {
  const auth = getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const res = await searchconsole.sites.list();
  return (res.data.siteEntry || []).map(s => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = { getTopQueries, getTopPages, getQueriesForPage, listSites };
