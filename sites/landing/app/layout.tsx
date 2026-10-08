import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk } from 'next/font/google';
import './globals.css';

// Círculo has one face and lets weight carry the hierarchy (web/src/styles/circulo.css).
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-circ',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'StaySound — Tu música, sin nube',
  description:
    'Reproductor de música para Android y macOS: biblioteca local, letra sincronizada palabra por palabra, ecualizador y Android Auto. Descarga gratuita.',
  icons: {
    icon: '/favicon.png',
    apple: '/appicon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={hanken.variable}>{children}</body>
    </html>
  );
}
