// netlify/functions/anthropic-proxy.js
// Proxies requests to Anthropic /v1/messages
// Key stored in Netlify env var ANTHROPIC_KEY — never exposed to browser.
//
// Expects JSON POST body matching the Anthropic messages API shape.

const https = require('https');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_KEY env var not set on server' }) };
  }

  const bodyStr = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : (event.body || '{}');

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 502, body: JSON.stringify({ error: err.message }) });
    });

    req.write(bodyStr);
    req.end();
  });
};
