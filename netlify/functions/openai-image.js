// netlify/functions/openai-image.js
// Proxies requests to OpenAI /v1/images/edits
// Key is stored in Netlify env var OPENAI_KEY — never exposed to the browser.
//
// Expects multipart/form-data POST with:
//   image[]   — PNG blob of the P-line drawing (required)
//   image[]   — PNG blob of customer logo (optional, second entry)
//   prompt    — branding instructions string
//   unit      — unit number string (for logging)

const https = require('https');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_KEY env var not set on server' }) };
  }

  // The browser sends us a multipart body — we forward it as-is to OpenAI,
  // just swapping the Authorization header.
  // event.body is base64-encoded when isBase64Encoded is true.
  const bodyBuffer = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : Buffer.from(event.body || '', 'utf8');

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/edits',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': contentType,
        'Content-Length': bodyBuffer.length,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: responseBody,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        body: JSON.stringify({ error: err.message }),
      });
    });

    req.write(bodyBuffer);
    req.end();
  });
};
