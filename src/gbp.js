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
 * List all GBP accounts the authenticated user has access to.
 */
async function listAccounts() {
  const auth = getAuthClient();
  const mbam = google.mybusinessaccountmanagement({ version: 'v1', auth });

  const res = await mbam.accounts.list();
  return (res.data.accounts || []).map(a => ({
    name: a.name,           // e.g. "accounts/123456"
    accountName: a.accountName,
    type: a.type,
  }));
}

/**
 * List locations for a given GBP account.
 * @param {string} accountName - e.g. "accounts/123456"
 */
async function listLocations(accountName) {
  const auth = getAuthClient();
  const mbbi = google.mybusinessbusinessinformation({ version: 'v1', auth });

  const res = await mbbi.accounts.locations.list({
    parent: accountName,
    readMask: 'name,title,storefrontAddress',
    pageSize: 100,
  });

  return (res.data.locations || []).map(l => ({
    name: l.name,           // e.g. "locations/789"
    title: l.title,
    address: l.storefrontAddress
      ? [l.storefrontAddress.locality, l.storefrontAddress.administrativeArea].filter(Boolean).join(', ')
      : '',
  }));
}

/**
 * Publish a local post to a GBP location.
 * Uses the v4 My Business API via direct HTTP as the googleapis package
 * may not expose localPosts fully.
 *
 * @param {string} accountId - e.g. "accounts/123456"
 * @param {string} locationId - e.g. "locations/789"
 * @param {object} post - { summary, callToAction: { actionType, url }, topicType }
 */
async function publishPost(accountId, locationId, post) {
  const auth = getAuthClient();
  const accessToken = (await auth.getAccessToken()).token;

  // Build the local post body
  const body = {
    languageCode: 'en-GB',
    summary: post.summary,
    topicType: post.topicType || 'STANDARD',
  };

  if (post.callToAction && post.callToAction.url) {
    body.callToAction = {
      actionType: post.callToAction.actionType || 'LEARN_MORE',
      url: post.callToAction.url,
    };
  }

  // If it's an event, add event details
  if (post.topicType === 'EVENT' && post.event) {
    body.event = post.event;
  }

  // If it's an offer, add offer details
  if (post.topicType === 'OFFER' && post.offer) {
    body.offer = post.offer;
  }

  const url = `https://mybusiness.googleapis.com/v4/${accountId}/${locationId}/localPosts`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GBP API error (${res.status}): ${errBody}`);
  }

  return await res.json();
}

module.exports = { listAccounts, listLocations, publishPost };
