const querystring = require('querystring');

module.exports = async (req, res) => {
  // Allow all CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method Not Allowed' });
    return;
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = querystring.parse(body);
    }
  } else if (!req.body) {
    let raw = '';
    await new Promise((resolve) => {
      req.on('data', chunk => raw += chunk);
      req.on('end', () => {
        try {
          body = JSON.parse(raw);
        } catch (e) {
          body = querystring.parse(raw);
        }
        resolve();
      });
    });
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
    res.status(400).json({ success: false, error: 'এডমিন প্যানেলে সঠিক API Key পাওয়া যায়নি।' });
    return;
  }

  const origin = `https://${req.headers.host || 'manasamondirgoila.com'}`;
  const effectiveCallback = callbackUrl || `${origin}/api/payment-callback`;
  const effectiveCancel = cancelUrl || `${origin}/?payment_status=cancelled`;

  try {
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

      const orderToken = String(orderRef || Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6) || Math.floor(1000 + Math.random() * 9000);
      const userEmail = String(email || '').trim();
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
        res.status(200).json({ success: true, payment_url: uData.payment_url });
      } else {
        let errMsg = uData.message || (typeof uData === 'string' ? uData : 'UddoktaPay পেমেন্ট লিংক তৈরি করতে ব্যর্থ হয়েছে');
        if (errMsg === 'Api Do Not Match') {
          errMsg = 'API Key মেলেনি (Api Do Not Match)! অনুগ্রহ করে যাচাই করুন: আপনার অ্যাকাউন্টটি Sandbox (টেস্টিং) নাকি Live (আসল)। Sandbox অ্যাকাউন্ট হলে এডমিন প্যানেলে "স্যান্ডবক্স মোড" সিলেক্ট করুন, আর Live হলে "লাইভ প্রোডাকশন" সিলেক্ট করুন এবং Settings > API Keys থেকে সঠিক কী-টি দিন।';
        }
        res.status(200).json({ success: false, error: errMsg });
      }
    } else {
      // aamarPay
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
        res.status(200).json({ success: true, payment_url: aData.payment_url });
      } else {
        const errMsg = aData.message || (typeof aData.result === 'string' ? aData.result : 'aamarPay গেটওয়েতে সংযোগ ব্যর্থ হয়েছে');
        res.status(200).json({ success: false, error: errMsg });
      }
    }
  } catch (err) {
    console.error('Server payment initiation error:', err);
    res.status(500).json({ success: false, error: err.message || 'সার্ভার প্রক্রিয়াকরণে ত্রুটি' });
  }
};
