/**
 * Local Service Ads Lead Tracker
 * Uses the Local Services API to pull leads.
 * API docs: https://developers.google.com/local-services/ads/reference/rest
 */

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
 * Search for detailed lead reports.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} query - optional search filter
 */
async function getLeads(startDate, endDate, query) {
  const auth = getAuthClient();
  const accessToken = (await auth.getAccessToken()).token;

  const params = new URLSearchParams({
    'query': buildQuery(startDate, endDate, query),
  });

  const url = `https://localservices.googleapis.com/v1/detailedLeadReports:search?${params}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LSA API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const leads = (data.detailedLeadReports || []).map(lead => ({
    leadId: lead.leadId,
    businessName: lead.businessName || '',
    leadType: lead.leadType || '',
    leadCategory: lead.leadCategory || '',
    chargeStatus: lead.chargeStatus || '',
    currencyCode: lead.currencyCode || 'GBP',
    disputeStatus: lead.disputeStatus || '',
    creationTime: lead.leadCreationTimestamp || '',
    geo: lead.geo || '',
    messageLead: lead.messageLead ? {
      customerName: lead.messageLead.customerName || '',
      postalCode: lead.messageLead.postalCode || '',
      jobType: lead.messageLead.jobType || '',
    } : null,
    phoneLead: lead.phoneLead ? {
      chargedConnectedCallDurationSeconds: lead.phoneLead.chargedConnectedCallDurationSeconds || 0,
    } : null,
    charged: lead.chargeStatus === 'CHARGED',
  }));

  return {
    leads,
    totalCount: leads.length,
    nextPageToken: data.nextPageToken || null,
  };
}

/**
 * Get account-level report summaries.
 */
async function getAccountReports(startDate, endDate) {
  const auth = getAuthClient();
  const accessToken = (await auth.getAccessToken()).token;

  const params = new URLSearchParams({
    'query': buildAccountQuery(startDate, endDate),
  });

  const url = `https://localservices.googleapis.com/v1/accountReports:search?${params}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LSA API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return (data.accountReports || []).map(report => ({
    accountId: report.accountId,
    businessName: report.businessName || '',
    averageFiveStarRating: report.averageFiveStarRating || 0,
    totalReview: report.totalReview || 0,
    currentPeriodChargedLeads: report.currentPeriodChargedLeads || 0,
    currentPeriodTotalCost: report.currentPeriodTotalCost || 0,
    phoneLeadResponsiveness: report.phoneLeadResponsiveness || 0,
    impressionsLastTwoDays: report.impressionsLastTwoDays || 0,
  }));
}

function buildQuery(startDate, endDate, searchTerm) {
  let q = `lead_creation_timestamp >= "${startDate}" AND lead_creation_timestamp <= "${endDate}T23:59:59Z"`;
  if (searchTerm) {
    q += ` AND customer_name ~ "${searchTerm}"`;
  }
  return q;
}

function buildAccountQuery(startDate, endDate) {
  return `start_date = "${startDate}" AND end_date = "${endDate}"`;
}

module.exports = { getLeads, getAccountReports };
