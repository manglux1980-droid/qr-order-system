'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';

type Table = {
  id: string;
  table_number: number;
  label: string | null;
  qr_token: string;
};

// Fixed card size: 65mm x 50mm
const CARD_W_MM = 65;
const CARD_H_MM = 50;
const COLS = 2;
const ROWS = 5;
const PER_PAGE = COLS * ROWS;

function PrintPageInner() {
  const params = useSearchParams();
  const idsParam = params.get('ids') ?? '';

  const [tables, setTables] = useState<Table[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/tables');
      const json = await res.json();
      if (!res.ok) {
        alert(json.error);
        return;
      }
      const wanted = idsParam ? idsParam.split(',') : null;
      const list: Table[] = (json.tables ?? []).filter((t: Table) =>
        wanted ? wanted.includes(t.id) : true
      );
      setTables(list);

      const base = window.location.origin;
      const map: Record<string, string> = {};
      await Promise.all(
        list.map(async (t) => {
          const url = `${base}/r/${json.slug}/${t.qr_token}`;
          map[t.id] = await QRCode.toDataURL(url, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 512,
          });
        })
      );
      setQrMap(map);
      setLoading(false);
    })();
  }, [idsParam]);

  if (loading) return <div className="p-6 text-gray-900">กำลังสร้าง QR codes...</div>;

  const pages: Table[][] = [];
  for (let i = 0; i < tables.length; i += PER_PAGE) {
    pages.push(tables.slice(i, i + PER_PAGE));
  }

  return (
    <>
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center gap-4 flex-wrap">
        <h1 className="font-semibold text-gray-900">
          พิมพ์ QR — {tables.length} โต๊ะ ({pages.length} หน้า)
        </h1>
        <div className="text-sm text-gray-600">
          ขนาด {CARD_W_MM}×{CARD_H_MM} mm · {PER_PAGE} ใบ/หน้า
        </div>
        <button
          onClick={() => window.print()}
          className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          🖨️ พิมพ์ / บันทึก PDF
        </button>
      </div>

      {/* Print area */}
      <div className="print-area bg-gray-100 print:bg-white py-6 print:py-0">
        {pages.map((pageTables, pageIdx) => (
          <div key={pageIdx} className="a4-page bg-white mx-auto mb-6 print:mb-0 print:shadow-none shadow-md">
            <div className="card-grid">
              {pageTables.map((t) => (
                <QrCard key={t.id} table={t} qrDataUrl={qrMap[t.id]} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <style jsx global>{`
        .a4-page {
          width: 210mm;
          height: 297mm;
          box-sizing: border-box;
          padding: 10mm;
          page-break-after: always;
        }
        .a4-page:last-child {
          page-break-after: auto;
        }
        .card-grid {
          display: grid;
          grid-template-columns: repeat(${COLS}, ${CARD_W_MM}mm);
          grid-template-rows: repeat(${ROWS}, ${CARD_H_MM}mm);
          gap: 5mm;
          justify-content: center;
          align-content: start;
        }
        @page {
          size: A4;
          margin: 0;
        }
        @media print {
          /* Hide everything outside print area */
          .no-print,
          aside,
          nav {
            display: none !important;
          }

          /* Force full width — kill admin layout's sidebar offset */
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
          }
          body * {
            visibility: hidden;
          }
          .print-area,
          .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            width: 210mm !important;
          }
          main {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .a4-page {
            margin: 0 !important;
            box-shadow: none !important;
            page-break-after: always;
          }
        }
      `}</style>
    </>
  );
}

function QrCard({ table, qrDataUrl }: { table: Table; qrDataUrl: string }) {
  return (
    <div
      style={{
        width: `${CARD_W_MM}mm`,
        height: `${CARD_H_MM}mm`,
        border: '1px solid #111',
        borderRadius: '2mm',
        padding: '2mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'white',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: '14pt',
          fontWeight: 700,
          lineHeight: 1,
          color: '#111',
        }}
      >
        #{table.table_number}
        {table.label && table.label !== `โต๊ะ ${table.table_number}` && (
          <span style={{ fontSize: '8pt', fontWeight: 500, marginLeft: '2mm', color: '#374151' }}>
            {table.label}
          </span>
        )}
      </div>

      {qrDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={`QR ${table.table_number}`}
          style={{
            width: '30mm',
            height: '30mm',
            display: 'block',
          }}
        />
      )}

      <div
        style={{
          fontSize: '9pt',
          fontWeight: 600,
          color: '#111',
          letterSpacing: '0.02em',
        }}
      >
        Scan to Order
      </div>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-900">กำลังโหลด...</div>}>
      <PrintPageInner />
    </Suspense>
  );
}
