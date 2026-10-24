import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata:Metadata={title:'CalTrack | 日々の、ちょうどいいを。',description:'食事・体重・消費カロリーを記録し、一日のバランスを振り返るプライベートノート。',robots:{index:false,follow:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#234a38'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body>{children}</body></html>;}
