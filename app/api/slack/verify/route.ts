import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, route: 'slack-verify' });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: any = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }

  if (body?.type === 'url_verification' && body?.challenge) {
    return new NextResponse(String(body.challenge), {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json({ ok: true });
}
