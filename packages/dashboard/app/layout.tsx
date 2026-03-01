import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from './components/sidebar';
import { NotificationBell } from './components/notification-bell';

export const metadata: Metadata = {
  title: 'Makilab — Mission Control',
  description: 'Agent dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body>
        <Sidebar />
        <div className="layout-right">
          <header className="top-header">
            <NotificationBell />
          </header>
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
