'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/', label: 'Command Center', icon: '\u{1F3E0}' },
      { href: '/activity', label: 'Activite', icon: '\u{1F4CA}' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { href: '/chat', label: 'Chat', icon: '\u{1F4AC}' },
      { href: '/todo', label: 'Todo', icon: '\u{2705}' },
      { href: '/tasks', label: 'Taches', icon: '\u{1F504}' },
      { href: '/connections', label: 'Connections', icon: '\u{1F50C}' },
      { href: '/costs', label: 'Costs', icon: '\u{1F4B0}' },
      { href: '/models', label: 'Models', icon: '\u{1F916}' },
      { href: '/memory', label: 'Memoire', icon: '\u{1F9E0}' },
    ],
  },
  {
    label: 'SETTINGS',
    items: [
      { href: '/settings/notifications', label: 'Notifications', icon: '\u{1F514}' },
      { href: '/settings/retrieval', label: 'Auto-retrieval', icon: '\u{1F50D}' },
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
