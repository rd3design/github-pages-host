// netlify/functions/openai-image.js
// Accepts JSON from browser, builds multipart/form-data, forwards to OpenAI /v1/images/edits
// OPENAI_KEY stored in Netlify env vars — never exposed to browser.

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

  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'OPENAI_KEY env var not set on server' }),
    };
  }

  // Parse JSON body from browser
  let payload;
  try {
    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body || '{}');
    payload = JSON.parse(bodyStr);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body: ' + e.message }),
    };
  }

  const { prompt, imageBase64, logoBase64, unitNumber } = payload;

  if (!prompt || !imageBase64) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing required fields: prompt, imageBase64' }),
    };
  }

  // Build multipart/form-data manually
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const CRLF = '\r\n';

  const parts = [];

  function addField(name, value) {
    parts.push(
      '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="' + name + '"' + CRLF + CRLF +
      value + CRLF
    );
  }

  function addFile(fieldName, filename, base64Data, mimeType) {
    const fileBuffer = Buffer.from(base64Data, 'base64');
    const header =
      '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="' + fieldName + '"; filename="' + filename + '"' + CRLF +
      'Content-Type: ' + mimeType + CRLF + CRLF;
    parts.push({ header, buffer: fileBuffer });
  }

  addField('model', 'gpt-image-1');
  addField('prompt', prompt);
  addField('n', '1');
  addField('size', '1024x1024');
  addField('quality', 'medium');
  addFile('image[]', 'unit_' + (unitNumber || 'drawing') + '.png', imageBase64, 'image/png');

  if (logoBase64) {
    addFile('image[]', 'customer_logo.png', logoBase64, 'image/png');
  }

  // Assemble body buffer
  const closingBoundary = '--' + boundary + '--' + CRLF;
  const bodyParts = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      bodyParts.push(Buffer.from(part, 'utf8'));
    } else {
      bodyParts.push(Buffer.from(part.header, 'utf8'));
      bodyParts.push(part.buffer);
      bodyParts.push(Buffer.from(CRLF, 'utf8'));
    }
  }
  bodyParts.push(Buffer.from(closingBoundary, 'utf8'));
  const bodyBuffer = Buffer.concat(bodyParts);

  // Forward to OpenAI
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/edits',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': bodyBuffer.length,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        console.log('[openai-image] OpenAI status:', res.statusCode);
        if (res.statusCode !== 200) {
          console.error('[openai-image] OpenAI error:', responseBody.slice(0, 500));
        }
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: responseBody,
        });
      });
    });

    req.on('error', (err) => {
      console.error('[openai-image] Request error:', err.message);
      resolve({
        statusCode: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: err.message }),
      });
    });

    req.write(bodyBuffer);
    req.end();
  });
};
