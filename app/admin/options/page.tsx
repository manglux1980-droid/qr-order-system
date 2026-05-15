'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Plus, Minus, X, Edit2, Trash2, Upload, Loader2 } from 'lucide-react';

type OptionItem = {
  id?: string;
  name_th: string;
  name_en: string | null;
  name_zh: string | null;
  name_ja: string | null;
  name_ko: string | null;
  price_delta: number;
  image_url: string | null;
  sort_order: number;
};

type OptionGroup = {
  id: string;
  restaurant_id: string;
  name_th: string;
  name_en: string | null;
  name_zh: string | null;
  name_ja: string | null;
  name_ko: string | null;
  selection_type: 'single' | 'multi';
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  option_group_items: OptionItem[];
};

export default function OptionGroupsPage() {
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OptionGroup | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/option-groups');
    const json = await res.json();
    if (res.ok) setGroups(json.groups ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm('ลบกลุ่มตัวเลือกนี้? เมนูที่ผูกอยู่จะไม่มีตัวเลือกนี้อีก')) return;
    const res = await fetch(`/api/option-groups?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json();
      alert(json.error);
      return;
    }
    load();
  }

  function openNew() { setEditing(null); setShowForm(true); }
  function openEdit(g: OptionGroup) { setEditing(g); setShowForm(true); }

  return (
    <div className="p-6 max-w-5xl mx-auto text-gray-900">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">ตัวเลือกพิเศษ</h1>
          <p className="text-sm text-gray-600 mt-1">
            กลุ่มตัวเลือกที่ใช้ร่วมกันหลายเมนู เช่น &quot;เนื้อสัตว์&quot;, &quot;Topping&quot;, &quot;ความเผ็ด&quot;
          </p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600"
        >
          + เพิ่มกลุ่ม
        </button>
      </div>

      {loading && <div className="text-gray-600">กำลังโหลด...</div>}

      {!loading && groups.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">🎨</div>
          <p className="text-gray-700 font-medium">ยังไม่มีกลุ่มตัวเลือก</p>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-900">{g.name_th}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${g.selection_type === 'single' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {g.selection_type === 'single' ? 'เลือก 1' : 'เลือกหลาย'}
                  </span>
                  {g.is_required && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      บังคับ
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {g.option_group_items.map((it) => (
                    <div key={it.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-1.5 pr-3">
                      {it.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.image_url} alt={it.name_th} className="w-8 h-8 rounded object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-200 flex items-center justify-center text-sm">🍽️</div>
                      )}
                      <span className="text-xs text-gray-700">{it.name_th}</span>
                      {Number(it.price_delta) !== 0 && (
                        <span className={`text-xs font-medium ${Number(it.price_delta) > 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {Number(it.price_delta) > 0 ? '+' : ''}{it.price_delta}฿
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEdit(g)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                  title="แก้ไข"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => remove(g.id)}
                  className="p-2 hover:bg-red-50 text-red-600 rounded-lg"
                  title="ลบ"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <OptionGroupForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Form Modal ───
function OptionGroupForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: OptionGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [nameTh, setNameTh] = useState(initial?.name_th ?? '');
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '');
  const [nameZh, setNameZh] = useState(initial?.name_zh ?? '');
  const [nameJa, setNameJa] = useState(initial?.name_ja ?? '');
  const [nameKo, setNameKo] = useState(initial?.name_ko ?? '');
  const [selectionType, setSelectionType] = useState<'single' | 'multi'>(
    initial?.selection_type ?? 'single'
  );
  const [isRequired, setIsRequired] = useState(initial?.is_required ?? false);
  const [items, setItems] = useState<OptionItem[]>(
    initial?.option_group_items?.length
      ? initial.option_group_items
      : [{ name_th: '', name_en: null, name_zh: null, name_ja: null, name_ko: null, price_delta: 0, image_url: null, sort_order: 0 }]
  );

  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeLang, setActiveLang] = useState<'th' | 'en' | 'zh' | 'ja' | 'ko'>('th');
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  function addItem() {
    setItems((prev) => [...prev, {
      name_th: '', name_en: null, name_zh: null, name_ja: null, name_ko: null,
      price_delta: 0, image_url: null, sort_order: prev.length,
    }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, key: keyof OptionItem, value: string | number | null) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  async function uploadImage(idx: number, file: File) {
    setUploadingIdx(idx);
    const ext = file.name.split('.').pop();
    const path = `options/${initial?.restaurant_id ?? 'new'}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('menu-images').upload(path, file);
    if (!error) {
      const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
      updateItem(idx, 'image_url', data.publicUrl);
    }
    setUploadingIdx(null);
  }

  async function translateAll() {
    if (!nameTh.trim()) {
      alert('ใส่ชื่อกลุ่มภาษาไทยก่อน');
      return;
    }
    const itemNames = items.map((it) => it.name_th.trim()).filter(Boolean);
    if (itemNames.length === 0) {
      alert('ใส่ชื่อตัวเลือกอย่างน้อย 1 รายการ');
      return;
    }

    setTranslating(true);
    try {
      const res = await fetch('/api/option-groups/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_name_th: nameTh, item_names_th: itemNames }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      setNameEn(json.group.en);
      setNameZh(json.group.zh);
      setNameJa(json.group.ja);
      setNameKo(json.group.ko);

      let translateIdx = 0;
      setItems((prev) => prev.map((it) => {
        if (!it.name_th.trim()) return it;
        const t = json.items[translateIdx++];
        if (!t) return it;
        return { ...it, name_en: t.en, name_zh: t.zh, name_ja: t.ja, name_ko: t.ko };
      }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'แปลไม่สำเร็จ');
    } finally {
      setTranslating(false);
    }
  }

  async function save() {
    if (!nameTh.trim()) return alert('ใส่ชื่อกลุ่ม');
    const validItems = items.filter((it) => it.name_th.trim());
    if (validItems.length === 0) return alert('เพิ่มตัวเลือกอย่างน้อย 1 รายการ');

    setSaving(true);
    const body = {
      ...(initial ? { id: initial.id } : {}),
      name_th: nameTh,
      name_en: nameEn || null,
      name_zh: nameZh || null,
      name_ja: nameJa || null,
      name_ko: nameKo || null,
      selection_type: selectionType,
      is_required: isRequired,
      items: validItems.map((it, idx) => ({
        name_th: it.name_th,
        name_en: it.name_en,
        name_zh: it.name_zh,
        name_ja: it.name_ja,
        name_ko: it.name_ko,
        price_delta: Number(it.price_delta) || 0,
        image_url: it.image_url || null,
        sort_order: idx,
      })),
    };

    const res = await fetch('/api/option-groups', {
      method: initial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json();
      alert(json.error);
      return;
    }
    onSaved();
  }

  const groupNameByLang: Record<typeof activeLang, [string, (v: string) => void]> = {
    th: [nameTh, setNameTh],
    en: [nameEn || '', setNameEn],
    zh: [nameZh || '', setNameZh],
    ja: [nameJa || '', setNameJa],
    ko: [nameKo || '', setNameKo],
  };
  const itemKeyByLang: Record<typeof activeLang, keyof OptionItem> = {
    th: 'name_th', en: 'name_en', zh: 'name_zh', ja: 'name_ja', ko: 'name_ko',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {initial ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท</label>
              <select
                value={selectionType}
                onChange={(e) => setSelectionType(e.target.value as 'single' | 'multi')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                <option value="single">เลือก 1 ตัว</option>
                <option value="multi">เลือกได้หลายตัว</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">บังคับเลือก?</label>
              <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                />
                <span className="text-sm text-gray-700">บังคับให้เลือก</span>
              </label>
            </div>
          </div>

          <div className="border-b border-gray-200">
            <div className="flex gap-1 items-center">
              {(['th', 'en', 'zh', 'ja', 'ko'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setActiveLang(lang)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    activeLang === lang
                      ? 'border-b-2 border-orange-500 text-orange-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
              <button
                onClick={translateAll}
                disabled={translating}
                className="ml-auto px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-200 disabled:opacity-50 flex items-center gap-1"
              >
                <Sparkles size={14} />
                {translating ? 'กำลังแปล...' : 'แปลอัตโนมัติ (AI)'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ชื่อกลุ่ม ({activeLang.toUpperCase()})
              {activeLang === 'th' && <span className="text-red-500"> *</span>}
            </label>
            <input
              type="text"
              value={groupNameByLang[activeLang][0]}
              onChange={(e) => groupNameByLang[activeLang][1](e.target.value)}
              placeholder={activeLang === 'th' ? 'เช่น เนื้อสัตว์, Topping, ความเผ็ด' : ''}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ตัวเลือก</label>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <OptionItemRow
                  key={idx}
                  idx={idx}
                  item={it}
                  activeLang={activeLang}
                  itemKeyByLang={itemKeyByLang}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  onUpload={uploadImage}
                  uploading={uploadingIdx === idx}
                  canRemove={items.length > 1}
                />
              ))}
            </div>
            <button
              onClick={addItem}
              className="mt-2 w-full py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 flex items-center justify-center gap-1"
            >
              <Plus size={14} /> เพิ่มตัวเลือก
            </button>
          </div>

          <p className="text-xs text-gray-500">
            💡 ใส่ชื่อภาษาไทยให้ครบ แล้วกด &quot;แปลอัตโนมัติ (AI)&quot; ได้ภาษาอื่นทันที
          </p>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก...' : (initial ? 'บันทึก' : 'เพิ่มกลุ่ม')}
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionItemRow({
  idx, item, activeLang, itemKeyByLang, onUpdate, onRemove, onUpload, uploading, canRemove,
}: {
  idx: number;
  item: OptionItem;
  activeLang: 'th' | 'en' | 'zh' | 'ja' | 'ko';
  itemKeyByLang: Record<'th' | 'en' | 'zh' | 'ja' | 'ko', keyof OptionItem>;
  onUpdate: (idx: number, key: keyof OptionItem, value: string | number | null) => void;
  onRemove: (idx: number) => void;
  onUpload: (idx: number, file: File) => void;
  uploading: boolean;
  canRemove: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
      {/* Image */}
      <div className="flex-shrink-0">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(idx, f);
          }}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-12 h-12 rounded-lg bg-white border border-gray-300 overflow-hidden flex items-center justify-center hover:border-orange-400"
        >
          {uploading ? (
            <Loader2 className="animate-spin text-gray-400" size={16} />
          ) : item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Upload size={16} className="text-gray-400" />
          )}
        </button>
      </div>

      {/* Name */}
      <input
        type="text"
        value={(item[itemKeyByLang[activeLang]] as string) || ''}
        onChange={(e) => onUpdate(idx, itemKeyByLang[activeLang], e.target.value)}
        placeholder={activeLang === 'th' ? 'ชื่อตัวเลือก' : ''}
        className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400"
      />

      {/* Price delta */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">฿</span>
        <input
          type="number"
          value={item.price_delta}
          onChange={(e) => onUpdate(idx, 'price_delta', e.target.value)}
          className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm text-gray-900 text-right"
          placeholder="0"
        />
      </div>

      <button
        onClick={() => onRemove(idx)}
        className="p-1.5 hover:bg-red-100 text-red-600 rounded"
        disabled={!canRemove}
      >
        <Minus size={14} />
      </button>
    </div>
  );
}
