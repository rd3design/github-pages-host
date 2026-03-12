// netlify/functions/pdf-proxy.js
// Proxies a PDF from an external URL (e.g. Dropbox) and returns it
// with CORS headers so PDF.js in the browser can load it cross-origin.
//
// Usage: /.netlify/functions/pdf-proxy?url=<encoded PDF URL>

exports.handler = async function(event) {
  const url = event.queryStringParameters?.url;

  if (!url) {
    return { statusCode: 400, body: 'Missing ?url= parameter' };
  }

  // Only allow Dropbox and your own domains for security
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid URL' };
  }

  const allowed = [
    'dropbox.com',
    'dl.dropboxusercontent.com',
    'sterlingatm.com',
  ];
  const isAllowed = allowed.some(d => decoded.includes(d));
  if (!isAllowed) {
    return { statusCode: 403, body: 'URL not from allowed domain' };
  }

  // Force direct download for Dropbox
  const fetchUrl = decoded
    .replace('?dl=0', '?dl=1')
    .replace('&dl=0', '&dl=1')
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com');

  try {
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'SterlingATM-PDFProxy/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { statusCode: response.status, body: `Upstream error: ${response.statusText}` };
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: base64,
      isBase64Encoded: true,
    };
  } catch(err) {
    return { statusCode: 502, body: `Proxy error: ${err.message}` };
  }
};
