'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './theme-provider';
import {
  LayoutDashboard,
  BarChart3,
  MessageSquare,
  CheckSquare,
  ListTodo,
  Plug,
  DollarSign,
  Cpu,
  Brain,
  Bell,
  Search,
  ScrollText,
  Route,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'OVERVIEW',
    items: [
      { href: '/', label: 'Command Center', icon: LayoutDashboard },
      { href: '/activity', label: 'Activite', icon: BarChart3 },
      { href: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { href: '/chat', label: 'Chat', icon: MessageSquare },
      { href: '/todo', label: 'Todo', icon: CheckSquare },
      { href: '/tasks', label: 'Taches agent', icon: ListTodo },
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/costs', label: 'Costs', icon: DollarSign },
      { href: '/models', label: 'Models', icon: Cpu },
      { href: '/memory', label: 'Memoire', icon: Brain },
    ],
  },
  {
    label: 'SETTINGS',
    items: [
      { href: '/settings/prompt', label: 'Metaprompt', icon: ScrollText },
      { href: '/settings/notifications', label: 'Notifications', icon: Bell },
      { href: '/settings/retrieval', label: 'Auto-retrieval', icon: Search },
      { href: '/settings/llm', label: 'LLM Provider', icon: Route },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('makilab-sidebar');
    if (saved === 'collapsed') setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem('makilab-sidebar', collapsed ? 'collapsed' : 'expanded');
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '64px' : '240px');
  }, [collapsed]);

  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? 'Sombre' : theme === 'light' ? 'Clair' : 'Systeme';

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo">
        <span className="sidebar-logo-text">Makilab</span>
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="sidebar-nav">
        {SECTIONS.map((section) => (
          <div key={section.label} className="sidebar-section">
            <span className="sidebar-section-label">{section.label}</span>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-icon">
                    <Icon size={18} />
                  </span>
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className="theme-toggle-btn"
          onClick={cycleTheme}
          title={collapsed ? themeLabel : undefined}
        >
          <span className="theme-toggle-icon">
            <ThemeIcon size={18} />
          </span>
          <span>{themeLabel}</span>
        </button>
      </div>
    </aside>
  );
}
