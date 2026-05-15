export type Plan = 'starter' | 'pro' | 'enterprise'
export type UserRole = 'admin' | 'cashier' | 'kitchen'
export type SessionStatus = 'open' | 'ordering' | 'paying' | 'closed'
export type OrderStatus = 'pending' | 'confirmed' | 'cooking' | 'served' | 'cancelled'
export type OrderItemStatus = 'pending' | 'cooking' | 'done' | 'cancelled'
export type PaymentMethod = 'promptpay' | 'truemoney' | 'alipay_plus' | 'cash'
export type PaymentScope = 'full' | 'partial' | 'per_person'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'
export type Locale = 'th' | 'en' | 'zh' | 'ja' | 'ko'

export interface Restaurant {
  id: string
  name_th: string
  name_en: string | null
  slug: string
  logo_url: string | null
  plan: Plan
  is_active: boolean
  omise_account: string | null
  created_at: string
  updated_at: string
}

export interface Table {
  id: string
  restaurant_id: string
  table_number: number
  label: string | null
  qr_token: string
  is_active: boolean
  created_at: string
}

export interface MenuCategory {
  id: string
  restaurant_id: string
  name_th: string
  name_en: string | null
  name_zh: string | null
  name_ja: string | null
  name_ko: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface MenuItem {
  id: string
  category_id: string
  restaurant_id: string
  name_th: string
  name_en: string | null
  name_zh: string | null
  name_ja: string | null
  name_ko: string | null
  desc_th: string | null
  desc_en: string | null
  desc_zh: string | null
  desc_ja: string | null
  desc_ko: string | null
  price: number
  image_url: string | null
  spicy_level: number
  allergens: string[]
  is_available: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TableSession {
  id: string
  restaurant_id: string
  table_id: string
  session_code: string
  status: SessionStatus
  guest_count: number
  opened_at: string
  closed_at: string | null
}

export interface Order {
  id: string
  session_id: string
  restaurant_id: string
  device_id: string
  nickname: string | null
  status: OrderStatus
  note: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  quantity: number
  price_snapshot: number
  note: string | null
  status: OrderItemStatus
  created_at: string
}

export interface Payment {
  id: string
  session_id: string
  restaurant_id: string
  method: PaymentMethod
  scope: PaymentScope
  amount: number
  gateway_ref: string | null
  qr_image_url: string | null
  status: PaymentStatus
  paid_at: string | null
  created_at: string
}

// Extended types with joins
export interface MenuItemWithCategory extends MenuItem {
  menu_categories: MenuCategory
}

export interface OrderWithItems extends Order {
  order_items: (OrderItem & { menu_items: MenuItem })[]
}

export interface SessionWithOrders extends TableSession {
  orders: OrderWithItems[]
  tables: Table
}

// Cart types (client-side only)
export interface CartItem {
  menuItem: MenuItem
  quantity: number
  note?: string
}
