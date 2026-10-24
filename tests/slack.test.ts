import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySlackSignature, downloadSlackFile } from '../lib/slack';
test('Slack accepts fresh signatures and rejects tampering or stale replays',()=>{
  process.env.SLACK_SIGNING_SECRET='test-only-signing-secret';
  const timestamp=String(Math.floor(Date.now()/1000)),raw='{"type":"event_callback"}';
  const signature='v0='+crypto.createHmac('sha256',process.env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${raw}`).digest('hex');
  assert.equal(verifySlackSignature(raw,timestamp,signature),true);assert.equal(verifySlackSignature(raw+'x',timestamp,signature),false);assert.equal(verifySlackSignature(raw,String(Number(timestamp)-301),signature),false);assert.equal(verifySlackSignature(raw,'NaN',signature),false);assert.equal(verifySlackSignature(raw,timestamp,'wrong'),false);
});
test('Slack file downloader never sends a bot token to an arbitrary URL',async()=>{
  process.env.SLACK_BOT_TOKEN='test-only';
  await assert.rejects(()=>downloadSlackFile('https://example.com/image.jpg'),/Invalid Slack file URL/);
  await assert.rejects(()=>downloadSlackFile('http://files.slack.com/image.jpg'),/Invalid Slack file URL/);
});
