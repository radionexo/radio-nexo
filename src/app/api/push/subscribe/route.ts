import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ configured, count: 0 });
  }

  try {
    const { count, error } = await supabase
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json({ configured, count: 0, tableMissing: true });
    }

    return NextResponse.json({ configured, count: count ?? 0 });
  } catch {
    return NextResponse.json({ configured, count: 0 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { subscription, userName } = body || {};

    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return NextResponse.json(
        { error: 'Suscripción push inválida.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase no configurado.' },
        { status: 500 }
      );
    }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_name: typeof userName === 'string' ? userName.slice(0, 60) : 'Oyente',
        user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

    if (error) {
      console.error('[Push Subscribe] Supabase error:', error.message);
      return NextResponse.json(
        { error: 'No se pudo guardar la suscripción.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Push Subscribe] Error:', err);
    return NextResponse.json({ error: 'Error procesando solicitud.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const endpoint = body?.endpoint;
    if (!endpoint) {
      return NextResponse.json({ error: 'Falta endpoint.' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Error eliminando suscripción.' }, { status: 500 });
  }
}
