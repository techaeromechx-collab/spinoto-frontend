import { useState, useEffect, useMemo, useCallback } from 'react';
import { api, API_URL, getToken } from '../api/client.js';
import {
  FileText, Download, AlertTriangle, AlertCircle, Info,
  CheckCircle2, RefreshCw, ChevronDown, Sheet,
} from 'lucide-react';
import '../styles/Gstr1Page.css';

/* ── CSV ───────────────────────────────────────────────────────────────────
   Same shape as ReportsPage's downloadCSV so both pages produce files that
   behave identically in a spreadsheet. */
function downloadCSV(filename, rows, headers) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const inr = n => Number(n || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const n2 = n => Number(n || 0).toFixed(2);
/* dd/mm/yyyy, built from the parts rather than left to toLocaleDateString.
   'en-IN' happens to produce this shape today, but the separator and padding
   come from the browser's ICU data, so a machine with a different build could
   render a date on a GST return differently from every other one. This cannot.

   Two input shapes arrive here and they must be read differently:
     '2026-07-01'                 — a plain date, no time zone. Read literally;
                                    handing it to Date makes it UTC midnight,
                                    which renders as the day BEFORE anywhere
                                    west of Greenwich.
     '2026-07-01T00:00:00.000Z'   — what JSON does to a pg date column. Here
                                    the local getters are right, because they
                                    undo the same offset that created it. */
function parts(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { d: m[3], m: m[2], y: m[1] };
  }
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return { d: pad(dt.getDate()), m: pad(dt.getMonth() + 1), y: String(dt.getFullYear()) };
}
/** On screen. */
const dmy = v => { const p = parts(v); return p ? `${p.d}/${p.m}/${p.y}` : ''; };
/** In a filing CSV — the GST offline utility's templates use DD-MM-YYYY.
    Worth confirming on your first import; if it wants slashes, this is the one
    line to change and the screen stays as it is. */
const dmyFile = v => { const p = parts(v); return p ? `${p.d}-${p.m}-${p.y}` : ''; };

/* The month a document falls in, for the first column of the B2B export.
   Read off the same parts() as the date, NOT from a Date object — building a
   Date from 'YYYY-MM-DD' parses it as UTC, so an invoice dated the 1st comes
   back as the previous month for anyone reading it east of Greenwich, which
   is everyone using this. The year is not printed: a GSTR-1 period never
   spans two calendar years (Q4 is Jan-Mar), and the file name carries it. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = v => { const p = parts(v); return p ? (MONTHS[Number(p.m) - 1] || '') : ''; };

/* B2C Small has no invoice date to read a month from: Table 7 is one row per
   place of supply and rate for the WHOLE period, which is how it is filed.
   So its Month column carries the period itself — the month on a monthly
   return, the span on a quarterly one. Splitting those rows by month instead
   would change the shape of the figures, not just the columns. */
const periodMonths = pd => {
  const a = monthName(pd.from), b = monthName(pd.to);
  return a === b ? a : `${a}–${b}`;
};

/* Month and quarter options, newest first. Quarters follow the Indian
   financial year: Q1 is Apr-Jun, so 2026-Q4 is Jan-Mar 2027. */
function buildPeriods() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    months.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    });
  }
  const quarters = [];
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  for (let y = fyStartYear; y > fyStartYear - 2; y--) {
    for (let q = 4; q >= 1; q--) {
      const startMonth = [3, 6, 9, 0][q - 1];
      const sy = q === 4 ? y + 1 : y;
      const from = new Date(Date.UTC(sy, startMonth, 1));
      if (from > now) continue;
      const to = new Date(Date.UTC(sy, startMonth + 3, 0));
      quarters.push({
        value: `${y}-Q${q}`,
        label: `Q${q} FY${String(y).slice(2)}-${String(y + 1).slice(2)} · ` +
          `${from.toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}–` +
          `${to.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
      });
    }
  }
  return { months, quarters };
}

const SEV_ICON = { blocker: AlertCircle, warn: AlertTriangle, info: Info };

/* ── One issue ──────────────────────────────────────────────────────────────
   Title, then why it matters, then the documents themselves as a table.

   The old version printed the whole message as a paragraph and then joined the
   affected documents with a dot separator — "CI-000028 · Chain Sprocket Front
   · CI-000047 · werwer" — so an invoice number and an item description looked
   identical and you could not tell where one row ended. Columns fix that on
   their own.

   The list is paginated rather than truncated. It used to be cut to 50 on the
   server and to 12 again here, which meant that on a busy month the documents
   the warning is ABOUT could not be read at all. */
const PAGE = 8;

function IssueRows({ w }) {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');

  /* A column with nothing in it on any row is dropped. The document-range
     issue declares Date, Customer and Value because SOME of its rows are real
     invoices — when every row is a number that was never issued, those three
     are a wall of dashes that says nothing. The first column always stays. */
  const cols = useMemo(() => w.columns.filter((c, i) =>
    i === 0 || w.rows.some(r => r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== '')
  ), [w]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return w.rows;
    return w.rows.filter(r => cols.some(c =>
      String(r[c.key] ?? '').toLowerCase().includes(needle)));
  }, [w, cols, q]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  /* Resetting here rather than in an effect: filtering to two rows while
     sitting on page four otherwise shows an empty table for one render. */
  const safePage = page >= pages ? 0 : page;
  const visible = page >= pages ? rows.slice(0, PAGE) : shown;

  const cell = (r, c) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return <span className="g1-dash">—</span>;
    if (c.type === 'money') return inr(v);
    if (c.type === 'date') return dmy(v);
    if (c.type === 'ref') return <span className="g1-mono">{v}</span>;
    return String(v);
  };

  const copy = () => navigator.clipboard?.writeText(
    [cols.map(c => c.label).join('\t'),
      ...rows.map(r => cols.map(c => r[c.key] ?? '').join('\t'))].join('\n'));

  return (
    <div className="g1-issue__rows">
      <div className="g1-issue__tools">
        {w.rows.length > PAGE && (
          <input className="g1-issue__search" type="search" value={q}
            onChange={e => { setQ(e.target.value); setPage(0); }}
            placeholder={`Search ${w.rows.length} rows…`} aria-label="Search affected documents" />
        )}
        <span className="g1-issue__count">
          {rows.length === w.rows.length
            ? `${w.rows.length} ${w.rows.length === 1 ? 'row' : 'rows'}`
            : `${rows.length} of ${w.rows.length}`}
        </span>
        <button className="g1-issue__btn" onClick={copy}>Copy</button>
        <button className="g1-issue__btn" onClick={() => downloadCSV(
          `gstr1-${w.code}.csv`,
          rows.map(r => cols.map(c => r[c.key] ?? '')),
          cols.map(c => c.label))}>CSV</button>
      </div>

      <table className="g1-issue__table">
        <thead>
          <tr>{cols.map(c => (
            <th key={c.key} className={c.type === 'money' || c.type === 'count' ? 'num' : ''}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i}>{cols.map(c => (
              <td key={c.key} className={c.type === 'money' || c.type === 'count' ? 'num' : ''}>{cell(r, c)}</td>
            ))}</tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={cols.length} className="g1-issue__empty">Nothing matches “{q.trim()}”.</td></tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="g1-issue__pager">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
          <span>Page {safePage + 1} of {pages}</span>
          <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function Issue({ w }) {
  const Icon = SEV_ICON[w.severity] || Info;
  /* Collapsed by default only for the informational ones — a blocker that
     needs a click to be read is a blocker nobody reads. */
  const [open, setOpen] = useState(w.group !== 'info');
  return (
    <li className={`g1-issue g1-issue--${w.group}`}>
      <button className="g1-issue__head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Icon size={15} />
        <span className="g1-issue__title">{w.title || w.message}</span>
        {w.amount != null && <span className="g1-issue__amt">{inr(w.amount)}</span>}
        <ChevronDown size={14} className={`g1-issue__caret${open ? ' g1-issue__caret--on' : ''}`} />
      </button>
      {open && (
        <div className="g1-issue__body">
          {(w.why || w.message) && <p className="g1-issue__why">{w.why || w.message}</p>}
          {w.rows?.length > 0 && <IssueRows w={w} />}
        </div>
      )}
    </li>
  );
}

export default function Gstr1Page() {
  const { months, quarters } = useMemo(buildPeriods, []);
  const [mode, setMode]     = useState('month');
  const [month, setMonth]   = useState(months[0]?.value || '');
  const [quarter, setQuarter] = useState(quarters[0]?.value || '');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTable, setActiveTable] = useState('b2b');

  const load = useCallback(async () => {
    const qs = mode === 'month' ? `month=${month}` : `quarter=${quarter}`;
    if (mode === 'month' ? !month : !quarter) return;
    setLoading(true); setError('');
    try {
      setData(await api(`/api/reports/gstr1?${qs}`));
    } catch (e) {
      setError(e.message || 'Could not load the return');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, month, quarter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  /* ── The filing exports ──────────────────────────────────────────────────
     One CSV per GSTR-1 table, with the column names the government's offline
     utility expects — EXCEPT 4A B2B and the two B2C tables, which were widened
     on request and no longer match it. See the note on the 4A entry. Downloaded one at a time on
     purpose: a browser blocks a burst of simultaneous downloads, and a
     silently missing file is worse than one more click. */
  const filingFiles = useMemo(() => {
    if (!data) return [];
    const p = data.period.fp;
    const files = [];

    /* ── 4A is NOT the offline-utility layout any more ──────────────────────
       Asked for on 22 Sep 2026: lead with the month, drop E-Commerce GSTIN,
       which is empty on every row this business produces, and carry
       CGST / SGST / IGST so the file reads the same way the table on screen
       does. The month earns its place on a quarterly return, where one file
       holds three of them and only the date column says which is which.

       That is a deliberate trade. The government's offline tool expects this
       sheet to be exactly its own 13 columns and works the tax out itself from
       Rate x Taxable; these 16 will not import. This file is for reading and
       reconciling. If it ever needs to go into the tool again, the columns
       below go back to the list in the b2b,sez,de sheet of the portal
       template, in that order. */
    if (data.b2b.length) files.push({
      key: 'b2b', label: `Table 4A — B2B (${data.b2b.length} rows)`,
      name: `gstr1-${p}-b2b.csv`,
      headers: ['Month', 'GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date',
        'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate',
        'Invoice Type', 'Rate', 'CGST', 'SGST', 'IGST', 'Taxable Value',
        'Cess Amount'],
      rows: data.b2b.map(r => [monthName(r.invoice_date), r.gstin, r.receiver_name, r.invoice_no,
        dmyFile(r.invoice_date), n2(r.invoice_value), `${r.pos_code}-${r.pos_name}`,
        r.reverse_charge, '', r.invoice_type, n2(r.rate), n2(r.cgst), n2(r.sgst), n2(r.igst),
        n2(r.taxable), n2(r.cess)]),
    });

    if (data.b2cl?.length) files.push({
      key: 'b2cl', label: `Table 5 — B2C Large (${data.b2cl.length} rows)`,
      name: `gstr1-${p}-b2cl.csv`,
      /* Widened the same way as 4A. CGST and SGST are always zero here —
         Table 5 is inter-state by definition — but they are printed so the
         three B2C files line up column for column when they are read side by
         side. E-Commerce GSTIN was left in place; it was only dropped from 4A
         because that was asked for. */
      headers: ['Month', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply',
        'Applicable % of Tax Rate', 'Rate', 'CGST', 'SGST', 'IGST', 'Taxable Value',
        'Cess Amount', 'E-Commerce GSTIN'],
      rows: data.b2cl.map(r => [monthName(r.invoice_date), r.invoice_no, dmyFile(r.invoice_date),
        n2(r.invoice_value), `${r.pos_code}-${r.pos_name}`, '', n2(r.rate),
        n2(r.cgst), n2(r.sgst), n2(r.igst), n2(r.taxable), n2(r.cess), '']),
    });

    if (data.b2cs.length) files.push({
      key: 'b2cs', label: `Table 7 — B2C Small (${data.b2cs.length} rows)`,
      name: `gstr1-${p}-b2cs.csv`,
      headers: ['Month', 'Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate',
        'CGST', 'SGST', 'IGST', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
      rows: data.b2cs.map(r => [periodMonths(data.period), r.type,
        `${r.pos_code}-${r.pos_name}`, '', n2(r.rate),
        n2(r.cgst), n2(r.sgst), n2(r.igst), n2(r.taxable), n2(r.cess), '']),
    });

    if (data.nil_rated?.length) files.push({
      key: 'nil', label: `Table 8 — Nil / exempt / non-GST (${data.nil_rated.length} rows)`,
      name: `gstr1-${p}-nil-exempt.csv`,
      headers: ['Description', 'Nil Rated Supplies', 'Exempted', 'Non-GST Supplies',
        'UNCLASSIFIED AMOUNT — choose a column before filing'],
      rows: data.nil_rated.map(r => [r.label, '', '', '', n2(r.amount)]),
    });

    if (data.cdnr?.length) files.push({
      key: 'cdnr', label: `Table 9B — Credit notes, registered (${data.cdnr.length} rows)`,
      name: `gstr1-${p}-cdnr.csv`,
      headers: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note/Refund Voucher Number',
        'Note/Refund Voucher date', 'Invoice/Advance Receipt Number',
        'Invoice/Advance Receipt date', 'Pre GST', 'Document Type', 'Place Of Supply',
        'Note/Refund Voucher Value', 'Rate', 'Taxable Value', 'Cess Amount'],
      rows: data.cdnr.map(r => [r.gstin, r.receiver_name, r.note_no, dmyFile(r.note_date),
        r.original_invoice_no, dmyFile(r.original_invoice_date), 'N', r.note_type,
        `${r.pos_code}-${r.pos_name}`, n2(r.note_value), n2(r.rate), n2(r.taxable), n2(r.cess)]),
    });

    /* Table 12 goes out as TWO files, because the portal takes it as two
       lists — the offline-utility workbook has an hsn(b2b) sheet and an
       hsn(b2c) sheet. The backend already keys the summary on scope, so the
       same code at the same rate sold to a GSTIN customer and to a walk-in
       arrives here as two rows and is never added together.

       A file is only offered when it has rows: a quarter with no B2B sales
       should not hand somebody an empty CSV to wonder about. */
    const hsnFile = (scope, tableLabel) => {
      const rows = data.hsn.filter(r => r.scope === scope);
      if (!rows.length) return;
      files.push({
        key: `hsn_${scope}`,
        label: `Table 12 — HSN ${tableLabel} (${rows.length} rows)`,
        name: `gstr1-${p}-hsn-${scope}.csv`,
        headers: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value',
          'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount',
          'State/UT Tax Amount', 'Cess Amount'],
        rows: rows.map(r => [r.code, r.description, r.uqc, n2(r.quantity),
          n2(r.taxable + r.cgst + r.sgst + r.igst), n2(r.rate), n2(r.taxable),
          n2(r.igst), n2(r.cgst), n2(r.sgst), n2(r.cess)]),
      });
    };
    hsnFile('b2b', 'B2B');
    hsnFile('b2c', 'B2C');

    if (data.docs.length) files.push({
      key: 'docs', label: 'Table 13 — Documents issued',
      name: `gstr1-${p}-docs.csv`,
      headers: ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      rows: data.docs.map(r => [r.nature, r.from_no, r.to_no, r.total, r.cancelled]),
    });

    return files;
  }, [data]);

  /* One readable file covering the whole return, for review and for sending
     to whoever files it. Deliberately NOT the utility layout: this one is for
     a human, and a section column beats four separate attachments. */
  /* The whole return as one workbook — a sheet per table behind a Dashboard.
     Built on the server, from the same pass over the invoices that produced
     what is on screen, so the file cannot drift from the page.

     A raw authenticated fetch rather than api(), which parses JSON: the reply
     here is a binary body. Errors come back AS JSON, so a failure is read
     before it is reported — "HTTP 500" tells nobody anything. */
  const [bookBusy, setBookBusy] = useState(false);
  const downloadWorkbook = useCallback(async () => {
    if (!data) return;
    setBookBusy(true);
    try {
      /* The same query the page was loaded with, built the same way — the
         workbook must be for the period on screen, not for whatever the
         controls have been nudged to since. */
      const qs = mode === 'month' ? `month=${month}` : `quarter=${quarter}`;
      const res = await fetch(`${API_URL}/api/reports/gstr1/xlsx?${qs}`,
        { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) {
        let msg = `Could not build the workbook (HTTP ${res.status})`;
        try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSTR1-${data.company.gstin || 'return'}-${data.period.fp}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Could not build the workbook');
    } finally { setBookBusy(false); }
  }, [data, mode, month, quarter]);

  const downloadSummary = useCallback(() => {
    if (!data) return;
    const rows = [];
    const add = (section, ...cells) => rows.push([section, ...cells]);
    add('Period', data.period.label, `${dmy(data.period.from)} to ${dmy(data.period.to)}`, 'Filing period', data.period.fp, '', '', '');
    add('Company', data.company.name, data.company.gstin, `${data.company.state_code}-${data.company.state_name}`, '', '', '', '');
    add('', '', '', '', '', '', '', '');
    add('Totals', 'Invoices', data.totals.invoices, 'Invoice value', n2(data.totals.invoice_value), '', '', '');
    add('Totals', 'Taxable value', n2(data.totals.taxable), 'Nil / non-GST', n2(data.totals.nil_rated), '', '', '');
    add('Totals', 'CGST', n2(data.totals.cgst), 'SGST', n2(data.totals.sgst), 'IGST', n2(data.totals.igst), '');
    add('Totals', 'Total tax', n2(data.totals.total_tax), '', '', '', '', '');
    if (data.totals.credit_notes) {
      add('Totals', 'Credit notes netted off', data.totals.credit_notes,
        'Value', n2(data.totals.credit_note_value), '', '', '');
    }
    add('', '', '', '', '', '', '', '');
    for (const r of data.b2b) {
      add('4A B2B', r.gstin, r.receiver_name, r.invoice_no, dmy(r.invoice_date),
        `${r.rate}%`, n2(r.taxable), n2(r.cgst + r.sgst + r.igst));
    }
    for (const r of data.b2cl || []) {
      add('5 B2CL', '', '', r.invoice_no, dmy(r.invoice_date), `${r.rate}%`, n2(r.taxable), n2(r.igst));
    }
    for (const r of data.b2cs) {
      add('7 B2CS', `${r.pos_code}-${r.pos_name}`, `${r.invoice_count} invoices`, '', '',
        `${r.rate}%`, n2(r.taxable), n2(r.cgst + r.sgst + r.igst));
    }
    for (const r of data.nil_rated || []) {
      add('8 Nil/exempt', r.bucket, r.label, '', '', '', n2(r.amount), '');
    }
    for (const r of data.cdnr || []) {
      add('9B Credit note', r.gstin, r.receiver_name, r.note_no, dmy(r.note_date),
        `${r.rate}%`, n2(-r.taxable), n2(-(r.cgst + r.sgst + r.igst)));
    }
    for (const r of data.hsn) {
      add(`12 HSN ${r.scope === 'b2b' ? 'B2B' : 'B2C'}`, r.code, r.description, r.uqc,
        n2(r.quantity), `${r.rate}%`, n2(r.taxable), n2(r.cgst + r.sgst + r.igst));
    }
    for (const r of data.docs) {
      add('13 Documents', r.nature, r.from_no, r.to_no, r.total, `${r.cancelled} cancelled`, '', '');
    }
    for (const w of data.warnings) add('Warning', w.severity, w.message, '', '', '', '', '');
    downloadCSV(`gstr1-${data.period.fp}-summary.csv`, rows,
      ['Section', 'A', 'B', 'C', 'D', 'Rate', 'Taxable', 'Tax']);
  }, [data]);

  /* ── The six tables, defined once ────────────────────────────────────────
     One definition per GSTR-1 table, used both for the tab strip and for the
     table body. A table with no rows still gets a tab: "Table 4A: 0" is an
     answer, and silently dropping the tab would leave you wondering whether
     there were no B2B invoices or whether the page forgot to draw them.

     Table 5 and Table 8 are the exceptions — they are omitted entirely when
     empty, because neither has ever applied to this business and a permanent
     pair of zeroes is just noise. */
  const tables = useMemo(() => {
    if (!data) return [];
    const t = [];

    t.push({
      key: 'b2b', tab: '4A', tabLabel: 'B2B', count: data.b2b.length,
      title: 'Table 4A — B2B invoices',
      empty: 'No B2B invoices in this period.',
      head: ['GSTIN', 'Receiver', 'Invoice', 'Date', 'Invoice value', 'Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
      numeric: [4, 6, 7, 8, 9, 10],
      rows: data.b2b.map(r => [r.gstin, r.receiver_name, r.invoice_no, dmy(r.invoice_date),
        inr(r.invoice_value), `${r.pos_code}-${r.pos_name}`, `${r.rate}%`,
        inr(r.taxable), inr(r.cgst), inr(r.sgst), inr(r.igst)]),
    });

    if (data.b2cl?.length) t.push({
      key: 'b2cl', tab: '5', tabLabel: 'B2C Large', count: data.b2cl.length,
      title: 'Table 5 — B2C Large',
      head: ['Invoice', 'Date', 'Invoice value', 'Place of supply', 'Rate', 'Taxable', 'IGST'],
      numeric: [2, 4, 5, 6],
      rows: data.b2cl.map(r => [r.invoice_no, dmy(r.invoice_date), inr(r.invoice_value),
        `${r.pos_code}-${r.pos_name}`, `${r.rate}%`, inr(r.taxable), inr(r.igst)]),
    });

    t.push({
      key: 'b2cs', tab: '7', tabLabel: 'B2C Small', count: data.b2cs.length,
      title: 'Table 7 — B2C Small (summarised)',
      note: 'Not listed invoice by invoice — B2C small is reported as one line per place of supply and rate.',
      empty: 'No B2C supplies in this period.',
      head: ['Type', 'Place of supply', 'Invoices', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
      numeric: [2, 3, 4, 5, 6, 7],
      rows: data.b2cs.map(r => [r.type, `${r.pos_code}-${r.pos_name}`, r.invoice_count,
        `${r.rate}%`, inr(r.taxable), inr(r.cgst), inr(r.sgst), inr(r.igst)]),
    });

    if (data.nil_rated?.length) t.push({
      key: 'nil', tab: '8', tabLabel: 'Nil / exempt', count: data.nil_rated.length, flag: true,
      title: 'Table 8 — Nil rated, exempted and non-GST',
      note: 'Which column each amount belongs in is a classification call. In this data it is fuel, which is a non-GST supply.',
      head: ['', 'Description', 'Lines', 'Amount (unclassified)'],
      numeric: [2, 3],
      rows: data.nil_rated.map(r => [r.bucket, r.label, r.line_count, inr(r.amount)]),
    });

    if (data.cdnr?.length) t.push({
      key: 'cdnr', tab: '9B', tabLabel: 'Credit notes', count: data.cdnr.length,
      title: 'Table 9B — Credit notes to registered buyers',
      note: 'Only notes to GST-registered customers are listed here. Notes to unregistered customers are netted into Table 7 instead — listing those separately would reduce the liability twice.',
      head: ['GSTIN', 'Receiver', 'Note', 'Note date', 'Against invoice', 'Invoice date', 'Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
      numeric: [7, 8, 9, 10, 11],
      rows: data.cdnr.map(r => [r.gstin, r.receiver_name, r.note_no, dmy(r.note_date),
        r.original_invoice_no, dmy(r.original_invoice_date), `${r.pos_code}-${r.pos_name}`,
        `${r.rate}%`, inr(r.taxable), inr(r.cgst), inr(r.sgst), inr(r.igst)]),
    });

    t.push({
      key: 'hsn', tab: '12', tabLabel: 'HSN / SAC', count: data.hsn.length,
      title: 'Table 12 — HSN / SAC summary',
      empty: 'No lines with a code.',
      /* 'For' leads, because the same code now appears twice — once per
         list — and without it the table looks like it has duplicates. */
      head: ['For', 'HSN / SAC', 'Description', 'UQC', 'Qty', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
      numeric: [4, 5, 6, 7, 8, 9],
      rows: data.hsn.map(r => [r.scope === 'b2b' ? 'B2B' : 'B2C', r.code, r.description, r.uqc,
        n2(r.quantity), `${r.rate}%`,
        inr(r.taxable), inr(r.cgst), inr(r.sgst), inr(r.igst)]),
    });

    t.push({
      key: 'docs', tab: '13', tabLabel: 'Documents', count: data.docs.length,
      title: 'Table 13 — Documents issued',
      head: ['Nature', 'From', 'To', 'Total', 'Cancelled', 'Dated outside this period'],
      numeric: [3, 4, 5],
      rows: data.docs.map(r => [r.nature, r.from_no, r.to_no, r.total, r.cancelled, r.outside_period ?? 0]),
    });

    return t;
  }, [data]);

  /* Falls back to the first tab when the active one stops existing — changing
     period can remove Table 5 or Table 8, and an active key pointing at
     nothing would render a blank card rather than an obvious default. */
  useEffect(() => {
    if (tables.length && !tables.some(t => t.key === activeTable)) setActiveTable(tables[0].key);
  }, [tables, activeTable]);
  const active = tables.find(t => t.key === activeTable) || tables[0] || null;

  /* Grouped by what you have to DO about it, not by severity level. The
     banner then counts exactly the boxes in the red group — the old version
     said "2 things would file wrong" above four near-identical cards. */
  const groups = useMemo(() => {
    const all = data?.warnings || [];
    const pick = g => all.filter(w => (w.group || (w.severity === 'info' ? 'info' : 'fix')) === g);
    return { fix: pick('fix'), check: pick('check'), info: pick('info') };
  }, [data]);
  const blockers = groups.fix;
  const recon = data?.reconciliation;

  return (
    <div className="g1-page">
      <header className="g1-header">
        <div className="g1-header-left">
          <span className="g1-header-icon"><FileText size={19} /></span>
          <div>
            <h1 className="g1-title">GSTR-1</h1>
            <p className="g1-sub">Outward supplies, built from customer invoices</p>
          </div>
        </div>

        <div className="g1-header-right">
          <div className="g1-seg">
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
            <button className={mode === 'quarter' ? 'on' : ''} onClick={() => setMode('quarter')}>Quarter</button>
          </div>

          {mode === 'month' ? (
            <select className="g1-select" value={month} onChange={e => setMonth(e.target.value)}>
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          ) : (
            <select className="g1-select" value={quarter} onChange={e => setQuarter(e.target.value)}>
              {quarters.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
          )}

          <button className="g1-icon-btn" onClick={load} disabled={loading} title="Reload">
            <RefreshCw size={15} className={loading ? 'g1-spin' : ''} />
          </button>

          <div className="g1-menu-wrap" onClick={e => e.stopPropagation()}>
            <button className="g1-btn g1-btn--primary" disabled={!data || !filingFiles.length}
              onClick={() => setMenuOpen(o => !o)}>
              <Download size={15} /> Download for filing <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <div className="g1-menu">
                <div className="g1-menu__note">One file per table, in the offline-utility layout.</div>
                {filingFiles.map(f => (
                  <button key={f.key} onClick={() => { downloadCSV(f.name, f.rows, f.headers); setMenuOpen(false); }}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="g1-btn" onClick={downloadWorkbook} disabled={!data || bookBusy}>
            <Sheet size={15} /> {bookBusy ? 'Building…' : 'Excel workbook'}
          </button>

          <button className="g1-btn" onClick={downloadSummary} disabled={!data}>
            <Download size={15} /> Summary
          </button>
        </div>
      </header>

      {error && (
        <div className="g1-banner g1-banner--bad">
          <AlertCircle size={17} /><div><strong>Could not load the return</strong><span>{error}</span></div>
        </div>
      )}
      {loading && !data && <div className="g1-empty">Loading…</div>}

      {data && (
        <>
          <div className="g1-meta">
            <span><strong>{data.company.name}</strong></span>
            <span className="g1-chip">GSTIN {data.company.gstin || '— not set —'}</span>
            <span className="g1-chip">{data.company.state_code}-{data.company.state_name}</span>
            <span className="g1-chip g1-chip--dim">Filing period {data.period.fp}</span>
            <span className="g1-chip g1-chip--dim">{dmy(data.period.from)} → {dmy(data.period.to)}</span>
          </div>

          {/* Reconciliation first: the return is only worth reading once it
              agrees with the ledger it was built from. */}
          <div className={`g1-banner ${recon.material ? 'g1-banner--bad' : 'g1-banner--ok'}`}>
            {recon.material ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <div>
              <strong>
                {recon.material
                  ? 'This return does NOT reconcile to the invoice ledger'
                  : 'Reconciles to the invoice ledger'}
              </strong>
              <span>
                Ledger taxable {inr(recon.ledger_taxable)} vs return {inr(recon.return_taxable)}
                {' · '}ledger tax {inr(recon.ledger_gst)} vs return {inr(recon.return_tax)}
                {recon.material
                  ? ' — an invoice is missing from the return. Do not file until this is zero.'
                  : ' — every invoice in the period is accounted for.'}
              </span>
            </div>
          </div>

          {blockers.length > 0 && (
            <div className="g1-banner g1-banner--bad">
              <AlertCircle size={17} />
              <div>
                <strong>{blockers.length} thing{blockers.length > 1 ? 's' : ''} to fix before you file</strong>
                <span>Under &ldquo;Must fix&rdquo; below. Worth clearing before you export.</span>
              </div>
            </div>
          )}

          <div className="g1-kpis">
            <Kpi label="Invoices"      value={data.totals.invoices} sub={`${data.totals.b2b_invoices} B2B · ${data.totals.b2c_invoices} B2C`} />
            <Kpi label="Invoice value" value={inr(data.totals.invoice_value)} />
            <Kpi label="Taxable value" value={inr(data.totals.taxable)} sub={data.totals.nil_rated ? `+ ${inr(data.totals.nil_rated)} nil / non-GST` : null} />
            <Kpi label="CGST"          value={inr(data.totals.cgst)} />
            <Kpi label="SGST"          value={inr(data.totals.sgst)} />
            <Kpi label="IGST"          value={inr(data.totals.igst)} sub={data.totals.igst ? null : 'no inter-state supply'} />
            <Kpi label="Total tax"     value={inr(data.totals.total_tax)} strong />
          </div>

          {data.warnings.length > 0 && (
            <section className="g1-card">
              <h2>Before you file</h2>
              {[
                { key: 'fix',   title: 'Must fix',           note: 'These would make the return wrong.' },
                { key: 'check', title: 'Check and confirm',  note: 'Not errors — decisions only you can make.' },
                { key: 'info',  title: 'For your information', note: 'Nothing to do. Here so the figures are not a surprise.' },
              ].map(g => groups[g.key].length ? (
                <div key={g.key} className={`g1-group g1-group--${g.key}`}>
                  <div className="g1-group__head">
                    <h3>{g.title}</h3>
                    <span className="g1-group__count">{groups[g.key].length}</span>
                    <span className="g1-group__note">{g.note}</span>
                  </div>
                  <ul className="g1-issues">
                    {groups[g.key].map(w => <Issue key={w.code} w={w} />)}
                  </ul>
                </div>
              ) : null)}
            </section>
          )}

          {/* ── The tables, one at a time ──────────────────────────────────
              Six stacked cards meant scrolling past four irrelevant ones to
              reach the fifth. Tabs put every table one click away and keep the
              totals and the pre-flight checks above them permanently visible,
              which is the order you actually work in: check it reconciles,
              read what would file wrong, then go through a table. */}
          {active && (
            <section className="g1-card g1-card--tabs">
              <div className="g1-tabs" role="tablist">
                {tables.map(t => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={t.key === active.key}
                    className={`g1-tab${t.key === active.key ? ' g1-tab--on' : ''}${t.flag ? ' g1-tab--flag' : ''}`}
                    onClick={() => setActiveTable(t.key)}
                  >
                    <span className="g1-tab__no">{t.tab}</span>
                    <span className="g1-tab__name">{t.tabLabel}</span>
                    <span className="g1-tab__count">{t.count}</span>
                  </button>
                ))}
              </div>

              <div className="g1-tabpanel" role="tabpanel">
                <div className="g1-tabpanel__head">
                  <div>
                    <h2>{active.title}</h2>
                    {active.note && <p className="g1-card__note">{active.note}</p>}
                  </div>
                  {/* One table on screen can map to more than one file —
                      Table 12 is split into B2B and B2C — so this matches the
                      tab's key AND anything keyed under it, and renders a
                      button each. */}
                  {filingFiles
                    .filter(x => x.key === active.key || x.key.startsWith(`${active.key}_`))
                    .map(f => (
                      <button key={f.key} className="g1-btn g1-btn--sm"
                        onClick={() => downloadCSV(f.name, f.rows, f.headers)}
                        title={`Download ${f.name}`}>
                        <Download size={14} /> {f.key.startsWith('hsn_')
                          ? f.key.endsWith('b2b') ? 'B2B' : 'B2C'
                          : 'This table'}
                      </button>
                    ))}
                </div>

                {active.rows.length === 0 ? (
                  <p className="g1-card__empty">{active.empty || 'Nothing to report.'}</p>
                ) : (
                  <div className="g1-tablewrap">
                    <table className="g1-table">
                      <thead>
                        <tr>{active.head.map((h, i) => (
                          <th key={i} className={active.numeric.includes(i) ? 'num' : ''}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {active.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (
                              <td key={j} className={active.numeric.includes(j) ? 'num' : ''}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, strong }) {
  return (
    <div className={`g1-kpi${strong ? ' g1-kpi--strong' : ''}`}>
      <span className="g1-kpi__label">{label}</span>
      <span className="g1-kpi__value">{value}</span>
      {sub && <span className="g1-kpi__sub">{sub}</span>}
    </div>
  );
}
