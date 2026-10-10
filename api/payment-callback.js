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

  let body = req.body || {};

  // If body is buffer or string, parse it
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = querystring.parse(body);
    }
  } else if (!req.body && req.method === 'POST') {
    // Collect stream chunks
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

  // Also merge query parameters if GET
  const query = req.query || {};
  const data = { ...query, ...body };

  const status = (data.pay_status || data.status || data.status_code || '').toString().toLowerCase();
  const isSuccess = status === 'successful' || status === 'completed' || status === 'success' || status === '2' || (data.invoice_id && status !== 'failed' && status !== 'cancelled' && status !== 'canceled');

  const tranId = data.mer_txnid || data.tran_id || data.invoice_id || '';
  const bankTrxid = data.bank_trxid || data.pg_txnid || data.trx_id || '';
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
};
