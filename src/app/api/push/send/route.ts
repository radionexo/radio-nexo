import { NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(request: Request) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:radionexo.co@gmail.com';

  if (!publicKey || !privateKey) {
    return NextResponse.json(
      {
        error:
          'Faltan las variables NEXT_PUBLIC_VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en Vercel.',
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const title = String(body?.title || '🔴 RADIO NEXO · En Vivo').slice(0, 100);
    const message = String(
      body?.body || '¡Estamos al aire en directo! Toca para escuchar ahora.'
    ).slice(0, 240);
    const url = String(body?.url || '/');

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase no configurado.' }, { status: 500 });
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth');

    if (error) {
      return NextResponse.json(
        { error: 'Crea primero la tabla push_subscriptions en Supabase.' },
        { status: 500 }
      );
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, total: 0 });
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const payload = JSON.stringify({
      title,
      body: message,
      url,
      tag: `nexo-push-${Date.now()}`,
    });

    let sent = 0;
    let failed = 0;
    const expiredIds: string[] = [];

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload
          );
          sent++;
        } catch (err: any) {
          failed++;
          // 404 or 410 means the user revoked permission or uninstalled the PWA
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            expiredIds.push(sub.id);
          }
        }
      })
    );

    if (expiredIds.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', expiredIds);
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: subs.length,
      cleaned: expiredIds.length,
    });
  } catch (err) {
    console.error('[Push Send] Error:', err);
    return NextResponse.json({ error: 'Error enviando notificaciones.' }, { status: 500 });
  }
}
