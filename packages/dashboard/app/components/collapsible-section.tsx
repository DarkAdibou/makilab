'use client';
import { useState, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  count,
  icon: Icon,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible-section ${className ?? ''}`}>
      <button className="collapsible-header" onClick={() => setOpen(!open)}>
        {Icon && (
          <span className="sidebar-icon">
            <Icon size={16} />
          </span>
        )}
        <span>{title}</span>
        {count !== undefined && <span className="collapsible-count">{count}</span>}
        <span className={`collapsible-chevron ${open ? 'open' : ''}`}>
          <ChevronRight size={16} />
        </span>
      </button>
      <div className={`collapsible-content ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="collapsible-body">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
