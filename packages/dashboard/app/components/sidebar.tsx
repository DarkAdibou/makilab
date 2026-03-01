'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/', label: 'Command Center', icon: '🏠' },
      { href: '/chat', label: 'Chat', icon: '💬' },
      { href: '/activity', label: 'Activite', icon: '\u{1F4CA}' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { href: '/tasks', label: 'Taches', icon: '📋' },
      { href: '/connections', label: 'Connections', icon: '🔌' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-text">Makilab</span>
      </div>
      <nav className="sidebar-nav">
        {SECTIONS.map((section) => (
          <div key={section.label} className="sidebar-section">
            <span className="sidebar-section-label">{section.label}</span>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
              >
                <span className="sidebar-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
