import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from './components/sidebar';

export const metadata: Metadata = {
  title: 'Makilab — Mission Control',
  description: 'Agent dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body>
        <Sidebar />
        <main className="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}
