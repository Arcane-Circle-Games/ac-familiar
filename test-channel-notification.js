/**
 * Test script to send a channel notification webhook
 * Usage: node test-channel-notification.js
 */

const crypto = require('crypto');
const axios = require('axios');

// Configuration
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://ac-familiar-production.up.railway.app/webhooks/notification';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-webhook-secret-here';

// Test data for 894 AD campaign
const payload = {
  event: 'notification.session.reminder',
  userId: 'c06e8b7e-bad0-4e26-b35c-2df269cfe8bf',
  discordId: '93420059858305024',

  // Channel routing (configured via /set-game-channel)
  channelId: '1102611731206901864',
  serverId: '1021989248037036042',
  notificationMode: 'CHANNEL_ONLY', // Options: 'DM_ONLY', 'CHANNEL_ONLY', 'BOTH'

  notification: {
    type: 'SESSION_REMINDER',
    title: '⏰ Session Starting Soon!',
    message: 'Your session for **894 AD: The Saga of the Stag** starts in 2 hours!',
    actionUrl: 'https://arcanecircle.games/games/cmfp2fj6u0001ii04u21oql78',
    metadata: {
      sessionId: 'test-session-' + Date.now(),
      sessionNumber: 5,
      gameId: 'cmfp2fj6u0001ii04u21oql78',
      gameTitle: '894 AD: The Saga of the Stag',
      scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours from now
      gmName: 'Test GM'
    }
  },
  timestamp: Date.now()
};

// Generate webhook signature
function generateSignature(payload, secret) {
  const payloadString = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString);
  return 'sha256=' + hmac.digest('hex');
}

// Send webhook
async function sendTestWebhook() {
  const timestamp = Date.now().toString();

  console.log('📤 Sending test webhook...');
  console.log('URL:', WEBHOOK_URL);
  console.log('Mode:', payload.notificationMode);
  console.log('Channel ID:', payload.channelId);
  console.log('Discord User ID:', payload.discordId);
  console.log('\nPayload:');
  console.log(JSON.stringify(payload, null, 2));

  // Try with signature first if WEBHOOK_SECRET is provided
  let headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Timestamp': timestamp
  };

  if (WEBHOOK_SECRET && WEBHOOK_SECRET !== 'your-webhook-secret-here') {
    const signature = generateSignature(payload, WEBHOOK_SECRET);
    headers['X-Webhook-Signature'] = signature;
    console.log('\n🔐 Using webhook signature');
  } else {
    console.log('\n⚠️  No webhook secret - signature verification will be skipped');
  }

  try {
    const response = await axios.post(WEBHOOK_URL, payload, { headers });

    console.log('\n✅ Webhook sent successfully!');
    console.log('Response:', response.status, response.statusText);
    console.log('Data:', response.data);
  } catch (error) {
    console.error('\n❌ Failed to send webhook');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

// Run
sendTestWebhook();
