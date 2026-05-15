// This layout overrides the parent app/admin/layout.tsx
// so the print page renders without the sidebar.

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
