import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Sidebar } from './components/sidebar';
import { NotificationBell } from './components/notification-bell';
import { ThemeProvider } from './components/theme-provider';

export const metadata: Metadata = {
  title: 'Makilab — Mission Control',
  description: 'Agent dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
        <ThemeProvider>
          <Sidebar />
          <div className="layout-right">
            <header className="top-header">
              <NotificationBell />
            </header>
            <main className="main-content">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
