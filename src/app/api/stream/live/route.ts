import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const streamUrl = process.env.NEXT_PUBLIC_STREAM_URL;

  // If NEXT_PUBLIC_STREAM_URL points to an external icecast or http url, proxy cleanly
  if (streamUrl && streamUrl.startsWith('http')) {
    try {
      const response = await fetch(streamUrl, { cache: 'no-store' });
      return new Response(response.body, {
        headers: {
          'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
          'Cache-Control': 'no-cache, no-store, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    } catch {
      // Fallback below
    }
  }

  // Otherwise proxy from the local/internal bridge server
  try {
    const bridgeBase = process.env.BRIDGE_INTERNAL_URL || 'http://127.0.0.1:8000';
    const bridgeUrl = `${bridgeBase}/live`;
    const response = await fetch(bridgeUrl, { cache: 'no-store' });
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'El servidor de streaming bridge no se encuentra activo aún en el puerto 8000.' },
      { status: 503 }
    );
  }
}
