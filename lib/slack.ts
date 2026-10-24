import crypto from 'node:crypto';

export async function slackWorkspaceId() {
  if (process.env.SLACK_WORKSPACE_ID) return process.env.SLACK_WORKSPACE_ID;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('Slack is not configured');
  const response = await fetch('https://slack.com/api/auth.test', { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  const identity = await response.json();
  if (!identity.ok || typeof identity.team_id !== 'string') throw new Error('Slack workspace verification failed');
  return identity.team_id as string;
}

export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function postSlackMessage(channel: string, text: string, threadTs?: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text, thread_ts: threadTs }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Slack post failed');
  return json;
}

export async function downloadSlackFile(url: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not configured');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'files.slack.com') throw new Error('Invalid Slack file URL');
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > 10000000) throw new Error('Slack image too large');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 10000000) throw new Error('Slack image too large');
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new Error('Unsupported image');
  return `data:${type};base64,${bytes.toString('base64')}`;
}
