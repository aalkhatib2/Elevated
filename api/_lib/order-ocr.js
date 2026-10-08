// Pulls order fields out of OCR text from T-Fiber "Order details" screenshots.
// Pure text parsing — the OCR engine itself lives with the caller.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Inside the 8-digit date, letters that look like digits can only be digits.
const digitFix = (s) => s.replace(/[OQoD]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');

export function parseOrderText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = text.replace(/\s+/g, '');
  const out = { orderNumber: null, gigs: null, clientName: null, installDate: null, isContinuation: false };

  // Anchored on "20" + date rather than the prefix length: the bold "O" in
  // "TMO" sometimes OCRs as two characters.
  const m = flat.match(/TM[O0Q]{1,3}(20[0-9OQIlSBD|]{6})([A-Z0-9]{5})/i);
  if (m) out.orderNumber = `TMO${digitFix(m[1])}${m[2].toUpperCase()}`;

  const g = text.match(/Fiber\s*([12])\s*Gig/i);
  if (g) out.gigs = Number(g[1]);
  else if (/2000\s*Mbps/i.test(text)) out.gigs = 2;
  else if (/1000\s*Mbps/i.test(text)) out.gigs = 1;

  // The customer's name is the first plain-words line under "Contact info";
  // the email and phone lines after it are skipped and never kept.
  const ci = lines.findIndex((l) => /contact\s*info/i.test(l));
  if (ci >= 0) {
    for (let k = ci + 1; k < Math.min(lines.length, ci + 4); k++) {
      const l = lines[k];
      if (/[@\d]/.test(l)) continue;
      if (/^[A-Za-z][A-Za-z'.\- ]{2,40}$/.test(l) && l.split(/\s+/).length >= 2) {
        out.clientName = l;
        break;
      }
    }
  }

  const inst = text.search(/Installation\s*details/i);
  if (inst >= 0) {
    const d = text.slice(inst).match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2})\s*,?\s*(\d{4})/i
    );
    if (d) out.installDate = `${d[3]}-${String(MONTHS[d[1].toLowerCase()]).padStart(2, '0')}-${d[2].padStart(2, '0')}`;
  }

  out.isContinuation = !out.orderNumber && (ci >= 0 || inst >= 0);
  return out;
}

// One Discord post can hold several screenshots. Each screenshot with an
// order number is an order; a continuation page (contact / install details)
// is only attached when there is exactly one order to attach it to.
export function groupPost(parsedImages) {
  const orders = parsedImages.filter((p) => p.orderNumber).map((p) => ({ ...p }));
  const continuations = parsedImages.filter((p) => p.isContinuation);
  if (orders.length === 1) {
    for (const c of continuations) {
      orders[0].clientName = orders[0].clientName || c.clientName;
      orders[0].installDate = orders[0].installDate || c.installDate;
      orders[0].gigs = orders[0].gigs ?? c.gigs;
    }
  }
  return {
    orders,
    unattachedContinuation: orders.length !== 1 && continuations.length > 0,
    continuationOnly: orders.length === 0 && continuations.length > 0,
  };
}
