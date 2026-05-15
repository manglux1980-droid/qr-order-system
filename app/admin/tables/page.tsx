'use client';

import { useEffect, useState } from 'react';

type Table = {
  id: string;
  table_number: number;
  label: string | null;
  qr_token: string;
  is_active: boolean;
};

export default function TablesAdminPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [slug, setSlug] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // single add
  const [newNumber, setNewNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // bulk add
  const [bulkFrom, setBulkFrom] = useState('');
  const [bulkTo, setBulkTo] = useState('');

  // editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/tables');
    const json = await res.json();
    if (res.ok) {
      setTables(json.tables ?? []);
      setSlug(json.slug ?? '');
    } else {
      alert(json.error ?? 'load failed');
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addOne() {
    const n = parseInt(newNumber);
    if (!n || n < 1) return alert('ใส่เลขโต๊ะ');
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_number: n,
        label: newLabel || `โต๊ะ ${n}`,
      }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json.error);
    setNewNumber('');
    setNewLabel('');
    load();
  }

  async function addBulk() {
    const from = parseInt(bulkFrom);
    const to = parseInt(bulkTo);
    if (!from || !to || from > to) return alert('ตรวจสอบช่วงเลขโต๊ะ');
    if (to - from > 100) return alert('สูงสุด 100 โต๊ะ/ครั้ง');
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json.error);
    setBulkFrom('');
    setBulkTo('');
    load();
  }

  async function saveEdit(id: string) {
    const res = await fetch('/api/tables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label: editLabel }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json.error);
    setEditingId(null);
    load();
  }

  async function toggleActive(t: Table) {
    await fetch('/api/tables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('ลบโต๊ะนี้?')) return;
    const res = await fetch(`/api/tables?id=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) return alert(json.error);
    load();
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectAll() {
    if (selected.size === tables.length) setSelected(new Set());
    else setSelected(new Set(tables.map((t) => t.id)));
  }

  function printSelected() {
    const ids = selected.size > 0 ? Array.from(selected) : tables.map((t) => t.id);
    const qs = new URLSearchParams({ ids: ids.join(',') });
    window.open(`/admin/tables/print?${qs.toString()}`, '_blank');
  }

  if (loading) return <div className="p-6 text-gray-900">กำลังโหลด...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">จัดการโต๊ะ</h1>
        <button
          onClick={printSelected}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          🖨️ พิมพ์ QR ({selected.size > 0 ? selected.size : 'ทั้งหมด'})
        </button>
      </div>

      {/* Add forms */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <h2 className="font-semibold mb-3 text-gray-900">เพิ่มทีละโต๊ะ</h2>
          <div className="flex gap-2">
            <input
              type="number"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              placeholder="เลขโต๊ะ"
              className="border border-gray-300 rounded px-3 py-2 w-24 text-gray-900 placeholder-gray-400"
            />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="ชื่อ (ไม่ใส่ก็ได้)"
              className="border border-gray-300 rounded px-3 py-2 flex-1 text-gray-900 placeholder-gray-400"
            />
            <button
              onClick={addOne}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              เพิ่ม
            </button>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 bg-white">
          <h2 className="font-semibold mb-3 text-gray-900">เพิ่มเป็นชุด</h2>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={bulkFrom}
              onChange={(e) => setBulkFrom(e.target.value)}
              placeholder="จาก"
              className="border border-gray-300 rounded px-3 py-2 w-20 text-gray-900 placeholder-gray-400"
            />
            <span className="text-gray-700">ถึง</span>
            <input
              type="number"
              value={bulkTo}
              onChange={(e) => setBulkTo(e.target.value)}
              placeholder="ถึง"
              className="border border-gray-300 rounded px-3 py-2 w-20 text-gray-900 placeholder-gray-400"
            />
            <button
              onClick={addBulk}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 ml-auto"
            >
              สร้าง
            </button>
          </div>
        </div>
      </div>

      {/* Tables list */}
      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
          <input
            type="checkbox"
            checked={selected.size === tables.length && tables.length > 0}
            onChange={selectAll}
          />
          <span className="text-sm text-gray-700">
            ทั้งหมด {tables.length} โต๊ะ {selected.size > 0 && `(เลือก ${selected.size})`}
          </span>
        </div>

        {tables.length === 0 ? (
          <div className="p-8 text-center text-gray-500">ยังไม่มีโต๊ะ — เพิ่มด้านบน</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {tables.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                />
                <span className="font-mono text-lg w-12 text-center text-gray-900 font-semibold">
                  #{t.table_number}
                </span>

                {editingId === t.id ? (
                  <>
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 flex-1 text-gray-900"
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(t.id)}
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 bg-gray-300 text-gray-900 rounded text-sm"
                    >
                      ยกเลิก
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-gray-900">{t.label}</span>
                    {!t.is_active && (
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs rounded">
                        ปิดใช้งาน
                      </span>
                    )}
                    <a
                      href={`/r/${slug}/${t.qr_token}`}
                      target="_blank"
                      className="text-blue-600 text-sm hover:underline font-medium"
                    >
                      เปิดหน้าลูกค้า ↗
                    </a>
                    <button
                      onClick={() => {
                        setEditingId(t.id);
                        setEditLabel(t.label ?? '');
                      }}
                      className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                    >
                      แก้
                    </button>
                    <button
                      onClick={() => toggleActive(t)}
                      className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                    >
                      {t.is_active ? 'ปิด' : 'เปิด'}
                    </button>
                    <button
                      onClick={() => remove(t.id)}
                      className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded font-medium"
                    >
                      ลบ
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-sm text-gray-600 mt-4">
        💡 เลือกโต๊ะที่ต้องการพิมพ์แล้วกด &quot;พิมพ์ QR&quot; — เลือก Layout ในหน้า preview
        แล้วใช้ Ctrl+P เพื่อ Save as PDF
      </p>
    </div>
  );
}
