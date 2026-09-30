import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  safeAdd,
  safeSub,
  safeMul,
  safeDiv,
  safePercentage,
  safeEqual,
  applyRounding,
  validateExchangeRate,
  convertCurrency,
  calculateLineItem,
} from './src/lib/currency';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Firebase Authentication Reverse Proxy (bypasses 3rd-party cookie blocking in iframes/sandboxes)
app.all('/__/auth/*', async (req, res) => {
  try {
    const targetUrl = `https://serious-flames-1np9f.firebaseapp.com${req.originalUrl}`;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() !== 'host' && typeof value === 'string') {
        headers[key] = value;
      }
    }

    let body: any = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
          body = new URLSearchParams(req.body).toString();
        } else {
          body = JSON.stringify(req.body);
        }
      } else if (typeof req.body === 'string') {
        body = req.body;
      }
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    res.status(response.status);
    response.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower !== 'content-encoding' && lower !== 'transfer-encoding' && lower !== 'content-length') {
        res.setHeader(key, val);
      }
    });

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.warn('Auth proxy error:', err);
    res.status(502).send('Auth proxy error');
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'hisabuk-pos-dual-currency',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Server-Authoritative Financial Calculation Engine for Invoices
 * Uses the authoritative BigNumber financial precision engine from src/lib/currency.ts.
 * Guarantees zero floating-point drift, deterministic rounding, and strict rate validation.
 */
app.post('/api/financial/calculate-invoice', (req, res) => {
  try {
    const {
      items,
      discount_type,
      discount_value,
      exchange_rate,
      rounding_rule,
      sdg_decimals,
      usd_decimals,
    } = req.body;

    const rule: 'round' | 'ceil' | 'floor' =
      rounding_rule === 'ceil' || rounding_rule === 'floor' ? rounding_rule : 'round';
    const sdgDec = typeof sdg_decimals === 'number' ? sdg_decimals : 0;
    const usdDec = typeof usd_decimals === 'number' ? usd_decimals : 2;

    const hasForeignCurrency =
      Array.isArray(items) && items.some((it: any) => it && it.currency === 'USD');

    // Strict validation: NEVER silently fallback to 2750 or any invented exchange rate
    let validRate: number | undefined = undefined;
    if (exchange_rate !== undefined && exchange_rate !== null && exchange_rate !== '') {
      const val = validateExchangeRate(exchange_rate);
      if (!val.isValid || typeof val.rate !== 'number') {
        return res.status(400).json({
          success: false,
          error: val.error || 'سعر الصرف المدخل غير صالح ومرفوض محاسبياً.',
        });
      }
      validRate = val.rate;
    } else if (hasForeignCurrency) {
      return res.status(400).json({
        success: false,
        error: 'الفاتورة تحتوي على بنود بالعملة الأجنبية وتتطلب إدخال سعر صرف صالح وموجب.',
      });
    }

    let subtotalSdg = 0;
    let subtotalUsd = 0;
    let taxTotalSdg = 0;
    let taxTotalUsd = 0;

    const processedItems = (items || []).map((item: any, index: number) => {
      const qty = Math.max(0, Number(item.quantity) || 0);
      const unitPrice = Math.max(0, Number(item.unit_price) || 0);
      const currency = item.currency === 'USD' ? 'USD' : 'SDG';
      const discPercent = Math.min(100, Math.max(0, Number(item.discount_percent) || 0));
      const taxRate = Math.max(0, Number(item.tax_rate) || 0);

      const itemDecimals = currency === 'SDG' ? sdgDec : usdDec;
      const line = calculateLineItem(qty, unitPrice, discPercent, taxRate, itemDecimals, rule);

      let lineSdg = 0;
      let lineUsd = 0;
      let lineNetSdg = 0;
      let lineNetUsd = 0;
      let itemTaxSdg = 0;
      let itemTaxUsd = 0;

      if (currency === 'SDG') {
        lineSdg = line.total;
        lineNetSdg = line.net;
        itemTaxSdg = line.tax;

        if (validRate) {
          lineUsd = convertCurrency(line.total, 'SDG', 'USD', validRate, {
            usd_decimals: usdDec,
            rounding_rule: rule,
          });
          lineNetUsd = convertCurrency(line.net, 'SDG', 'USD', validRate, {
            usd_decimals: usdDec,
            rounding_rule: rule,
          });
          itemTaxUsd = convertCurrency(line.tax, 'SDG', 'USD', validRate, {
            usd_decimals: usdDec,
            rounding_rule: rule,
          });
        }
      } else {
        lineUsd = line.total;
        lineNetUsd = line.net;
        itemTaxUsd = line.tax;

        if (validRate) {
          lineSdg = convertCurrency(line.total, 'USD', 'SDG', validRate, {
            sdg_decimals: sdgDec,
            rounding_rule: rule,
          });
          lineNetSdg = convertCurrency(line.net, 'USD', 'SDG', validRate, {
            sdg_decimals: sdgDec,
            rounding_rule: rule,
          });
          itemTaxSdg = convertCurrency(line.tax, 'USD', 'SDG', validRate, {
            sdg_decimals: sdgDec,
            rounding_rule: rule,
          });
        }
      }

      subtotalSdg = safeAdd(subtotalSdg, lineNetSdg, sdgDec, rule);
      subtotalUsd = safeAdd(subtotalUsd, lineNetUsd, usdDec, rule);
      taxTotalSdg = safeAdd(taxTotalSdg, itemTaxSdg, sdgDec, rule);
      taxTotalUsd = safeAdd(taxTotalUsd, itemTaxUsd, usdDec, rule);

      return {
        ...item,
        id: item.id || `item-${index + 1}`,
        line_total: currency === 'SDG' ? lineSdg : lineUsd,
        line_total_sdg: lineSdg,
        line_total_usd: lineUsd,
      };
    });

    // Invoice-level discount calculation
    let discountTotalSdg = 0;
    let discountTotalUsd = 0;
    const discVal = Math.max(0, Number(discount_value) || 0);

    if (discount_type === 'percent') {
      const pct = Math.min(100, discVal);
      discountTotalSdg = safePercentage(subtotalSdg, pct, sdgDec, rule);
      discountTotalUsd = safePercentage(subtotalUsd, pct, usdDec, rule);
    } else if (discount_type === 'fixed') {
      discountTotalSdg = Math.min(subtotalSdg, applyRounding(discVal, sdgDec, rule));
      discountTotalUsd = validRate
        ? convertCurrency(discountTotalSdg, 'SDG', 'USD', validRate, {
            usd_decimals: usdDec,
            rounding_rule: rule,
          })
        : 0;
    }

    const taxableSdg = safeSub(subtotalSdg, discountTotalSdg, sdgDec, rule);
    const taxableUsd = safeSub(subtotalUsd, discountTotalUsd, usdDec, rule);

    const grandTotalSdg = Math.max(0, safeAdd(taxableSdg, taxTotalSdg, sdgDec, rule));
    const grandTotalUsd = Math.max(0, safeAdd(taxableUsd, taxTotalUsd, usdDec, rule));

    return res.json({
      success: true,
      items: processedItems,
      subtotal_sdg: subtotalSdg,
      subtotal_usd: subtotalUsd,
      discount_total_sdg: discountTotalSdg,
      discount_total_usd: discountTotalUsd,
      tax_total_sdg: taxTotalSdg,
      tax_total_usd: taxTotalUsd,
      grand_total_sdg: grandTotalSdg,
      grand_total_usd: grandTotalUsd,
      exchange_rate_used: validRate ?? null,
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Server-Side Double-Entry Journal Voucher Validation
 * Enforces strict Debit === Credit invariants using authoritative financial engine.
 */
app.post('/api/accounting/validate-entry', (req, res) => {
  try {
    const { lines } = req.body;
    if (!Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({
        isValid: false,
        error: 'يجب أن يحتوي القيد المحاسبي على طرفين على الأقل (مدين ودائن)',
      });
    }

    const totalDebitSdg = lines.reduce(
      (s: number, l: any) => safeAdd(s, Number(l.debit_sdg) || 0, 0, 'round'),
      0
    );
    const totalCreditSdg = lines.reduce(
      (s: number, l: any) => safeAdd(s, Number(l.credit_sdg) || 0, 0, 'round'),
      0
    );
    const totalDebitUsd = lines.reduce(
      (s: number, l: any) => safeAdd(s, Number(l.debit_usd) || 0, 2, 'round'),
      0
    );
    const totalCreditUsd = lines.reduce(
      (s: number, l: any) => safeAdd(s, Number(l.credit_usd) || 0, 2, 'round'),
      0
    );

    const diffSdg = Math.abs(safeSub(totalDebitSdg, totalCreditSdg, 0, 'round'));
    const diffUsd = Math.abs(safeSub(totalDebitUsd, totalCreditUsd, 2, 'round'));

    const isBalancedSdg = safeEqual(totalDebitSdg, totalCreditSdg, 0);
    const isBalancedUsd = safeEqual(totalDebitUsd, totalCreditUsd, 2);
    const isValid = isBalancedSdg && isBalancedUsd;

    return res.json({
      isValid,
      totalDebitSdg,
      totalCreditSdg,
      diffSdg,
      totalDebitUsd,
      totalCreditUsd,
      diffUsd,
      message: isValid
        ? 'القيد متزن محاسبياً بنجاح'
        : 'القيد غير متزن: مجموع المدين لا يساوي مجموع الدائن',
    });
  } catch (err: any) {
    return res.status(500).json({ isValid: false, error: err.message });
  }
});

// Vite middleware for development vs static production serve
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hisabuk Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
