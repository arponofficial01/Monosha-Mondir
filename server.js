const http = require('http');
const fs = require('fs');
const path = require('path');

let PORT = parseInt(process.env.PORT || '3000', 10);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo'
};

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  let reqPath = decodeURI(req.url.split('?')[0]);

  // Fast health check for upload server availability
  if (req.method === 'GET' && (reqPath === '/api/upload-check' || reqPath === '/api/ping')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ ok: true, uploadEnabled: true }));
    return;
  }

  // Payment Gateway Initiation Endpoint (UddoktaPay & aamarPay Proxy)
  if (req.method === 'POST' && (reqPath === '/api/payment-initiate' || reqPath === '/payment-initiate')) {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      try {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch (e) {
          body = require('querystring').parse(raw);
        }

        const {
          provider = 'uddoktapay',
          mode = 'live',
          apiKey = '',
          storeId = '',
          amount = 0,
          orderRef = '',
          devoteeName = 'ভক্ত',
          phone = '',
          email = '',
          purpose = 'সাধারণ প্রণামী ও সেবা',
          selectedMethod = 'bkash',
          callbackUrl,
          cancelUrl
        } = body;

        const effectiveKey = (apiKey || '').trim();
        if (!effectiveKey) {
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ success: false, error: 'এডমিন প্যানেলে সঠিক API Key পাওয়া যায়নি।' }));
          return;
        }

        const origin = `http://${req.headers.host || 'localhost:3000'}`;
        const effectiveCallback = callbackUrl || `${origin}/api/payment-callback`;
        const effectiveCancel = cancelUrl || `${origin}/?payment_status=cancelled`;

        const userEmail = String(email || '').trim();

        if (provider === 'uddoktapay') {
          const normalizeUddoktaEndpoint = (rawUrl, m) => {
            if (!rawUrl || !rawUrl.trim()) {
              return m === 'live'
                ? 'https://pay.uddoktapay.com/api/checkout-v2'
                : 'https://sandbox.uddoktapay.com/api/checkout-v2';
            }
            let u = rawUrl.trim().replace(/\/+$/, '');
            if (u === 'https://uddoktapay.com' || u === 'http://uddoktapay.com') {
              u = 'https://pay.uddoktapay.com';
            }
            u = u.replace(/\/api\/checkout(-v2)?$/, '');
            u = u.replace(/\/checkout(-v2)?$/, '');
            u = u.replace(/\/api$/, '');
            return `${u}/api/checkout-v2`;
          };

          const endpoint = normalizeUddoktaEndpoint(body.apiBaseUrl, mode);

          const orderToken = String(orderRef || Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6) || Math.floor(1000 + Math.random() * 9000);
          let effectiveEmail = `donor.${orderToken}@manasamondirgoila.com`;
          if (userEmail && userEmail.includes('@')) {
            if (userEmail.includes('+')) {
              effectiveEmail = userEmail;
            } else {
              const parts = userEmail.split('@');
              effectiveEmail = `${parts[0]}+${orderToken}@${parts[1]}`;
            }
          }

          const uddoktaPayload = {
            full_name: devoteeName || 'ভক্ত',
            email: effectiveEmail,
            amount: String(amount),
            metadata: {
              order_id: orderRef,
              phone: phone,
              purpose: purpose,
              channel: selectedMethod
            },
            redirect_url: effectiveCallback,
            return_type: 'GET',
            cancel_url: effectiveCancel,
            webhook_url: effectiveCallback
          };

          const uRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'RT-UDDOKTAPAY-API-KEY': effectiveKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(uddoktaPayload)
          });

          let uData = null;
          try {
            uData = await uRes.json();
          } catch (e) {
            uData = { status: false, message: uRes.status === 404 ? 'UddoktaPay এন্ডপয়েন্ট পাওয়া যায়নি (404 Not Found)' : `গেটওয়ে রেসপন্স ত্রুটি (${uRes.status})` };
          }

          if (uData && (uData.status === true || uData.status === 'true') && uData.payment_url) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: true, payment_url: uData.payment_url }));
          } else {
            let errMsg = uData.message || (typeof uData === 'string' ? uData : 'UddoktaPay পেমেন্ট তৈরি করতে ব্যর্থ হয়েছে');
            if (errMsg === 'Api Do Not Match') {
              errMsg = 'API Key মেলেনি (Api Do Not Match)! অনুগ্রহ করে যাচাই করুন: আপনার অ্যাকাউন্টটি Sandbox (টেস্টিং) নাকি Live (আসল)। Sandbox অ্যাকাউন্ট হলে এডমিন প্যানেলে "স্যান্ডবক্স মোড" সিলেক্ট করুন, আর Live হলে "লাইভ প্রোডাকশন" সিলেক্ট করুন এবং Settings > API Keys থেকে সঠিক কী-টি দিন।';
            }
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: errMsg }));
          }
          return;
        } else {
          // aamarPay Gateway
          const endpoint = mode === 'live'
            ? 'https://secure.aamarpay.com/jsonpost.php'
            : 'https://sandbox.aamarpay.com/jsonpost.php';

          const cleanPhone = String(phone || '').replace(/\D/g, '') || '01722428334';
          const orderToken = String(orderRef || Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '') || Date.now().toString(36);
          const effectiveEmail = userEmail || `donor.${orderToken}@manasamondirgoila.com`;

          const aamarPayload = {
            store_id: (storeId || 'aamarpaytest').trim(),
            signature_key: effectiveKey,
            cus_name: devoteeName || 'শ্রদ্ধেয় ভক্ত',
            cus_email: effectiveEmail,
            cus_phone: cleanPhone,
            amount: String(amount),
            currency: 'BDT',
            tran_id: orderRef,
            desc: purpose || 'শ্রী শ্রী মা মনসা মন্দির প্রণামী',
            success_url: effectiveCallback,
            fail_url: effectiveCallback,
            cancel_url: effectiveCancel,
            type: 'json'
          };

          const aRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(aamarPayload)
          });

          const aData = await aRes.json();
          if (aData && (aData.result === 'true' || aData.result === true) && aData.payment_url) {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: true, payment_url: aData.payment_url }));
          } else {
            const errMsg = aData.message || (typeof aData === 'string' ? aData : 'aamarPay গেটওয়েতে সংযোগ ব্যর্থ হয়েছে');
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ success: false, error: errMsg }));
          }
          return;
        }
      } catch (err) {
        console.error('Payment initiation server error:', err);
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: err.message || 'সার্ভার প্রক্রিয়াকরণে ত্রুটি' }));
      }
    });
    return;
  }

  // Payment Gateway Callback Endpoint (aamarPay & UddoktaPay)
  if (reqPath === '/api/payment-callback' || reqPath === '/payment-callback') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = require('querystring').parse(raw);
      }
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      urlObj.searchParams.forEach((v, k) => { if (!data[k]) data[k] = v; });

      const status = (data.pay_status || data.status || data.status_code || '').toString().toLowerCase();
      const isSuccess = status === 'successful' || status === 'completed' || status === 'success' || status === '2' || (data.invoice_id && status !== 'failed' && status !== 'cancelled');
      const tranId = data.mer_txnid || data.tran_id || data.invoice_id || '';
      const bankTrxid = data.bank_trxid || data.pg_txnid || data.trx_id || tranId;
      const amount = data.amount || data.amount_original || '';
      const cardType = data.card_type || data.card_brand || data.payment_method || 'Online';
      const cusName = data.cus_name || data.full_name || '';
      const cusPhone = data.cus_phone || '';

      const redirectUrl = `/?payment_status=${isSuccess ? 'success' : 'failed'}` +
        `&tran_id=${encodeURIComponent(tranId)}` +
        `&bank_trxid=${encodeURIComponent(bankTrxid)}` +
        `&amount=${encodeURIComponent(amount)}` +
        `&method=${encodeURIComponent(cardType)}` +
        `&name=${encodeURIComponent(cusName)}` +
        `&phone=${encodeURIComponent(cusPhone)}`;

      res.writeHead(302, { Location: redirectUrl });
      res.end();
    });
    return;
  }

  // Direct unlimited video / media upload endpoint
  if (req.method === 'POST' && (reqPath === '/api/upload' || reqPath === '/upload')) {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryFilename = urlObj.searchParams.get('filename') || req.headers['x-filename'] || ('video_' + Date.now() + '.mp4');
    const safeExt = path.extname(queryFilename).toLowerCase() || '.mp4';
    const cleanBase = path.basename(queryFilename, safeExt).replace(/[^a-zA-Z0-9_\-\u0980-\u09FF]/g, '_').slice(0, 50) || 'media';
    const finalFilename = `${cleanBase}_${Date.now()}${safeExt}`;

    const uploadDir = path.join(__dirname, 'uploads', 'videos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const destPath = path.join(uploadDir, finalFilename);
    const writeStream = fs.createWriteStream(destPath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        success: true,
        url: `uploads/videos/${finalFilename}`,
        filename: finalFilename
      }));
    });

    writeStream.on('error', (err) => {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // HTTP Range request support for smooth video streaming, seeking and buffering
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

      if (start >= stats.size) {
        res.writeHead(416, {
          'Content-Range': `bytes */${stats.size}`,
          'Access-Control-Allow-Origin': '*'
        });
        res.end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      fileStream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.mp4' || ext === '.webm' || ext === '.mp3' ? 'public, max-age=3600' : 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`\n========================================`);
    console.log(` Shree Shree Maa Manasa Mandir Server`);
    console.log(` Local:   http://localhost:${port}/`);
    console.log(`========================================\n`);
  });

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(err);
    }
  });
}

startServer(PORT);
