// Write access to the fiber-sales workbook, used only by the Discord sales bot.
//
// Kept apart from sheets.js on purpose: the portal's request handlers import
// that file and must only ever hold a read-only token. This one needs a
// service account with Editor access on the sheet — an API key cannot write.

import { getServiceAccountToken, WRITE_SCOPE } from './sheets.js';

async function writeFetch(path, { method = 'GET', params = {}, body } = {}) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID is not set');

  const token = await getServiceAccountToken(WRITE_SCOPE);
  if (!token) {
    throw new Error(
      'Sheet writes need GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (an API key cannot write)'
    );
  }

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  // The Sheets API allows ~60 requests/minute per user; a busy bot run can
  // brush that, so back off on 429 instead of failing the run.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429 || attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sheets API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Rows come back as FORMATTED_VALUE strings, the same as the portal's reader.
export async function readRange(range) {
  const data = await writeFetch(`/values/${encodeURIComponent(range)}`, {
    params: { valueRenderOption: 'FORMATTED_VALUE' },
  });
  return data.values || [];
}

// USER_ENTERED so "09/28/2026" lands as a real date and "=…" as a formula,
// exactly as if typed into the cell.
export function writeRange(range, values) {
  return writeFetch(`/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    params: { valueInputOption: 'USER_ENTERED' },
    body: { range, majorDimension: 'ROWS', values },
  });
}

export function writeRanges(data) {
  return writeFetch('/values:batchUpdate', {
    method: 'POST',
    body: { valueInputOption: 'USER_ENTERED', data },
  });
}

export function appendRows(range, values) {
  return writeFetch(`/values/${encodeURIComponent(range)}:append`, {
    method: 'POST',
    params: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' },
    body: { majorDimension: 'ROWS', values },
  });
}

export function clearRanges(ranges) {
  return writeFetch('/values:batchClear', { method: 'POST', body: { ranges } });
}

export async function getSheetProps() {
  const data = await writeFetch('', { params: { fields: 'sheets.properties(sheetId,title,index)' } });
  return (data.sheets || []).map((s) => s.properties);
}

// Structural edits: add a tab, insert a row, duplicate a sheet.
export function batchUpdate(requests) {
  return writeFetch(':batchUpdate', { method: 'POST', body: { requests } });
}
