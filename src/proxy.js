/**
 * Dev proxy middleware — forwards /api/* requests to the remote server.
 * Activate by setting REMOTE_API_URL in .env, e.g.:
 *   REMOTE_API_URL=http://192.168.1.39:3000
 *
 * When set, all API routes hit the remote server (Unraid) instead of the local database.
 * Static files are still served locally so you see your code changes immediately.
 */

function createProxyMiddleware(remoteUrl) {
  // Strip trailing slash
  const baseUrl = remoteUrl.replace(/\/$/, '');

  return async (req, res, next) => {
    // Only proxy /api/* routes
    if (!req.path.startsWith('/api/')) return next();

    const targetUrl = `${baseUrl}${req.originalUrl}`;
    const method = req.method;

    try {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      // Forward body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const data = await response.text();

      res.status(response.status);
      res.set('Content-Type', response.headers.get('content-type') || 'application/json');
      res.send(data);
    } catch (err) {
      console.error(`Proxy error (${method} ${targetUrl}):`, err.message);
      res.status(502).json({ error: `Failed to reach remote server: ${err.message}` });
    }
  };
}

module.exports = { createProxyMiddleware };
