'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Save, Copy, Check, Eye, EyeOff } from 'lucide-react'
import { isValidPromptPayId } from '@/lib/promptpay'

type Restaurant = {
  id: string
  name_th: string
  promptpay_id: string | null
  promptpay_name: string | null
  payment_mode: 'omise' | 'manual' | 'sms'
  sms_webhook_secret: string | null
}

export default function SettingsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)

  const [promptpayId, setPromptpayId] = useState('')
  const [promptpayName, setPromptpayName] = useState('')
  const [paymentMode, setPaymentMode] = useState<'omise' | 'manual' | 'sms'>('manual')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: ru } = await supabase
      .from('restaurant_users')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .single()

    if (!ru) return

    const { data: rest } = await supabase
      .from('restaurants')
      .select('id, name_th, promptpay_id, promptpay_name, payment_mode, sms_webhook_secret')
      .eq('id', ru.restaurant_id)
      .single()

    if (rest) {
      const r = rest as Restaurant
      setRestaurant(r)
      setPromptpayId(r.promptpay_id || '')
      setPromptpayName(r.promptpay_name || '')
      // Map 'sms' from DB → 'manual' + SMS enabled (since they're now combined)
      if (r.payment_mode === 'sms') {
        setPaymentMode('manual')
        setSmsEnabled(true)
      } else {
        setPaymentMode(r.payment_mode || 'manual')
        setSmsEnabled(false)
      }
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!restaurant) return

    if (paymentMode === 'manual' && !promptpayId.trim()) {
      alert('กรุณากรอกเบอร์ PromptPay')
      return
    }
    if (promptpayId && !isValidPromptPayId(promptpayId)) {
      alert('เบอร์ PromptPay ไม่ถูกต้อง (ต้องเป็นเบอร์มือถือ 10 หลัก)')
      return
    }

    // If manual mode + sms enabled → save as 'sms' (which means manual+sms)
    // If manual mode + sms disabled → save as 'manual'
    const dbMode = paymentMode === 'manual' && smsEnabled ? 'sms' : paymentMode

    setSaving(true)
    const { error } = await supabase
      .from('restaurants')
      .update({
        promptpay_id: promptpayId.trim() || null,
        promptpay_name: promptpayName.trim() || null,
        payment_mode: dbMode,
      })
      .eq('id', restaurant.id)

    setSaving(false)
    if (error) {
      alert('บันทึกไม่สำเร็จ: ' + error.message)
      return
    }
    alert('บันทึกเรียบร้อย ✓')
    load()
  }

  function copyWebhookUrl() {
    if (!restaurant?.sms_webhook_secret) return
    const url = `${window.location.origin}/api/payments/sms-webhook?secret=${restaurant.sms_webhook_secret}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-orange-500" size={32} />
    </div>
  )

  if (!restaurant) return <p>ไม่พบข้อมูลร้าน</p>

  const webhookUrl = restaurant.sms_webhook_secret
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/payments/sms-webhook?secret=${restaurant.sms_webhook_secret}`
    : ''

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">ตั้งค่าการชำระเงิน</h1>
        <p className="text-sm text-gray-500 mt-0.5">ตั้งค่าระบบรับเงินของร้าน</p>
      </div>

      {/* Payment Mode */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
        <h2 className="font-bold text-gray-900 mb-1">รูปแบบการรับชำระเงิน</h2>
        <p className="text-xs text-gray-500 mb-4">เลือกวิธีรับเงินจากลูกค้า</p>

        <div className="space-y-3">
          <label className={`block p-4 border-2 rounded-xl cursor-pointer transition-all ${paymentMode === 'manual' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="flex items-start gap-3">
              <input
                type="radio"
                checked={paymentMode === 'manual'}
                onChange={() => setPaymentMode('manual')}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900">
                  📱 PromptPay <span className="text-xs text-green-700 ml-2">แนะนำ · ฟรี</span>
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  ลูกค้าสแกน PromptPay ของร้าน → แม่ค้ายืนยันรับเงิน (เปิด SMS Auto ได้เพื่อยืนยันอัตโนมัติ)
                </p>
              </div>
            </div>
          </label>

          <label className={`block p-4 border-2 rounded-xl cursor-pointer transition-all ${paymentMode === 'omise' ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="flex items-start gap-3">
              <input
                type="radio"
                checked={paymentMode === 'omise'}
                onChange={() => setPaymentMode('omise')}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-semibold text-gray-900">
                  💳 Omise Payment Gateway <span className="text-xs text-gray-600 ml-2">มีค่าธรรมเนียม · auto</span>
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  ใช้ Omise สำหรับ PromptPay + บัตรเครดิต — ต้องสมัคร merchant + มีค่าธรรมเนียม
                </p>
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* PromptPay setup */}
      {paymentMode === 'manual' && (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <h2 className="font-bold text-gray-900 mb-1">ข้อมูล PromptPay ของร้าน</h2>
            <p className="text-xs text-gray-500 mb-4">เลข PromptPay ที่ลูกค้าจะโอนเข้ามา</p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  เบอร์มือถือ PromptPay <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={promptpayId}
                  onChange={(e) => setPromptpayId(e.target.value)}
                  placeholder="0812345678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <p className="text-xs text-gray-500 mt-1">เบอร์ 10 หลัก ขึ้นต้นด้วย 0</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ชื่อบัญชี (แสดงในใบเสร็จ)
                </label>
                <input
                  type="text"
                  value={promptpayName}
                  onChange={(e) => setPromptpayName(e.target.value)}
                  placeholder="ร้านอันตี้มอนสเตอร์"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          </div>

          {/* SMS Auto Confirmation toggle */}
          <div className={`rounded-2xl border-2 p-6 mb-4 transition-all ${smsEnabled ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={smsEnabled}
                onChange={(e) => setSmsEnabled(e.target.checked)}
                className="mt-1 w-5 h-5"
              />
              <div className="flex-1">
                <h2 className="font-bold text-gray-900">
                  📨 ยืนยันอัตโนมัติด้วย SMS (Optional)
                </h2>
                <p className="text-xs text-gray-600 mt-1">
                  ถ้าเปิด: SMS เงินเข้าจากธนาคาร → ยืนยันการจ่ายอัตโนมัติ ไม่ต้องกดยืนยันเอง<br/>
                  ถ้า SMS ไม่มา → ยังกดยืนยันเองที่ cashier ได้
                </p>
              </div>
            </label>

            {smsEnabled && (
              <div className="mt-4 pl-8">
                <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
                <div className="flex gap-2">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={webhookUrl}
                    readOnly
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 bg-white font-mono"
                  />
                  <button
                    onClick={() => setShowSecret(!showSecret)}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    onClick={copyWebhookUrl}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1 text-sm"
                  >
                    {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  🔒 อย่าแชร์ URL นี้ — มี secret token ป้องกันการปลอม
                </p>

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-blue-700">📖 วิธีติดตั้ง SMS Forwarder บน Android</summary>
                  <div className="mt-3 text-xs text-gray-700 space-y-2 bg-white p-3 rounded-lg">
                    <p>1. ติดตั้ง app <strong>SMS Forwarder</strong> หรือ <strong>SMS to URL Forwarder</strong> จาก Play Store</p>
                    <p>2. ให้ permission อ่าน SMS</p>
                    <p>3. ตั้ง rule: ผู้ส่งจาก KBank / SCB / BBL / KTB → forward ไป URL ด้านบน</p>
                    <p>4. Method: POST · Body: ส่ง SMS content ทั้งหมด</p>
                    <p>5. ระบบจะ parse จำนวนเงิน + match กับ payment pending อัตโนมัติ</p>
                    <p className="text-orange-700 font-semibold pt-2 border-t">⚠️ มือถือต้องเปิดและ online ตลอด · ถ้า SMS ไม่มา สามารถกดยืนยันมือได้ที่หน้า cashier</p>
                  </div>
                </details>
              </div>
            )}
          </div>
        </>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full md:w-auto px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? (
          <><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</>
        ) : (
          <><Save size={16} /> บันทึกการตั้งค่า</>
        )}
      </button>
    </div>
  )
}
