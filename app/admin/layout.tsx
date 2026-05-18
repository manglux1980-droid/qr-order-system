'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UtensilsCrossed, QrCode, LayoutDashboard, LogOut, ChefHat, CreditCard, SlidersHorizontal, Smartphone, Settings } from 'lucide-react'

const navItems = [
  // Setup
  { href: '/admin/menu', label: 'จัดการเมนู', icon: UtensilsCrossed },
  { href: '/admin/options', label: 'ตัวเลือกพิเศษ', icon: SlidersHorizontal },
  { href: '/admin/tables', label: 'จัดการโต๊ะ / QR', icon: QrCode },
  { href: '/admin/preorder-qr', label: 'QR สั่งล่วงหน้า', icon: Smartphone },
  // Operations
  { href: '/admin/orders', label: 'ออเดอร์ (KDS)', icon: ChefHat },
  { href: '/admin/cashier', label: 'แคชเชียร์', icon: CreditCard },
  // Insights
  { href: '/admin/dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
  { href: '/admin/settings', label: 'ตั้งค่า', icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col fixed h-full">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍽️</span>
            <span className="font-semibold text-gray-900 text-sm">QR Order</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                pathname === href
                  ? 'bg-orange-50 text-orange-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-50 w-full transition-colors"
          >
            <LogOut size={18} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-56 p-6">
        {children}
      </main>
    </div>
  )
}
