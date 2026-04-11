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
 * Run a GA4 report.
 * @param {string} propertyId - Numeric GA4 property ID (e.g. "123456789")
 * @param {object} options - { startDate, endDate, dimensions, metrics, limit, orderBy }
 */
async function runReport(propertyId, options = {}) {
  const auth = getAuthClient();
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });

  const startDate = options.startDate || getDateDaysAgo(30);
  const endDate = options.endDate || getDateDaysAgo(1);
  const dimensions = (options.dimensions || ['date']).map(d => ({ name: d }));
  const metrics = (options.metrics || ['sessions', 'totalUsers', 'newUsers']).map(m => ({ name: m }));
  const limit = options.limit || 50;

  const requestBody = {
    dateRanges: [{ startDate, endDate }],
    dimensions,
    metrics,
    limit,
  };

  if (options.orderBy) {
    requestBody.orderBys = [options.orderBy];
  }

  const res = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody,
  });

  const dimHeaders = (res.data.dimensionHeaders || []).map(h => h.name);
  const metHeaders = (res.data.metricHeaders || []).map(h => h.name);

  const rows = (res.data.rows || []).map(row => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
    (row.metricValues || []).forEach((v, i) => { obj[metHeaders[i]] = parseFloat(v.value) || 0; });
    return obj;
  });

  // Totals
  const totals = {};
  if (res.data.totals && res.data.totals.length) {
    (res.data.totals[0].metricValues || []).forEach((v, i) => {
      totals[metHeaders[i]] = parseFloat(v.value) || 0;
    });
  }

  return { rows, totals, startDate, endDate, dimensions: dimHeaders, metrics: metHeaders };
}

/**
 * Get overview stats for a property.
 */
async function getOverview(propertyId, startDate, endDate) {
  return runReport(propertyId, {
    startDate,
    endDate,
    dimensions: [],
    metrics: ['sessions', 'totalUsers', 'newUsers', 'screenPageViews', 'averageSessionDuration', 'bounceRate'],
    limit: 1,
  });
}

/**
 * Get top pages by sessions.
 */
async function getTopPages(propertyId, startDate, endDate, limit = 30) {
  return runReport(propertyId, {
    startDate,
    endDate,
    dimensions: ['pagePath'],
    metrics: ['sessions', 'screenPageViews', 'totalUsers'],
    limit,
    orderBy: { metric: { metricName: 'sessions' }, desc: true },
  });
}

/**
 * Get traffic sources.
 */
async function getTrafficSources(propertyId, startDate, endDate) {
  return runReport(propertyId, {
    startDate,
    endDate,
    dimensions: ['sessionDefaultChannelGroup'],
    metrics: ['sessions', 'totalUsers', 'conversions'],
    limit: 20,
    orderBy: { metric: { metricName: 'sessions' }, desc: true },
  });
}

/**
 * Get daily sessions for a chart.
 */
async function getDailySessions(propertyId, startDate, endDate) {
  return runReport(propertyId, {
    startDate,
    endDate,
    dimensions: ['date'],
    metrics: ['sessions', 'totalUsers'],
    limit: 90,
    orderBy: { dimension: { dimensionName: 'date' }, desc: false },
  });
}

/**
 * List GA4 accounts and properties the user has access to.
 */
async function listProperties() {
  const auth = getAuthClient();
  const admin = google.analyticsadmin({ version: 'v1beta', auth });

  const res = await admin.accountSummaries.list({ pageSize: 100 });
  const properties = [];
  for (const account of (res.data.accountSummaries || [])) {
    for (const prop of (account.propertySummaries || [])) {
      properties.push({
        accountName: account.displayName,
        propertyId: prop.property.replace('properties/', ''),
        propertyName: prop.displayName,
      });
    }
  }
  return properties;
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = { getOverview, getTopPages, getTrafficSources, getDailySessions, listProperties };
