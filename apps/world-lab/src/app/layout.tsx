import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

export const metadata: Metadata = {
  title: 'World Lab',
  description: 'Developer interface for observing the Agentborne world.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
