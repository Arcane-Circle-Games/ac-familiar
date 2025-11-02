/**
 * Test script to send a game published webhook notification
 * Usage: node test-game-published-webhook.js
 */

const crypto = require('crypto');
const axios = require('axios');

// Configuration
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://ac-familiar-production.up.railway.app/webhooks/notification';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'your-webhook-secret-here';
const ANNOUNCEMENT_CHANNEL_ID = process.env.GAME_ANNOUNCEMENT_CHANNEL_ID || 'YOUR_CHANNEL_ID_HERE';

// Test data for newly published game
const payload = {
  event: 'notification.game.published',
  gameId: 'test-game-' + Date.now(),
  channelId: ANNOUNCEMENT_CHANNEL_ID, // Target announcement channel

  game: {
    id: 'cmfp2fj6u0001ii04u21oql78',
    title: 'Test Campaign: The Dragon\'s Lair',
    description: '<p>An <strong>epic adventure</strong> awaits! Join us for a thrilling campaign in a world of dragons and magic.</p><p>Perfect for players who enjoy <em>roleplay</em> and tactical combat.</p>',
    system: {
      name: 'Dungeons & Dragons 5th Edition',
      shortName: 'D&D 5e'
    },
    gameType: 'CAMPAIGN',
    gm: {
      displayName: 'DungeonMaster42',
      profile: {
        verified: true,
        averageRating: 4.8,
        totalRatings: 24
      }
    },
    startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
    duration: 3,
    pricePerSession: 15,
    maxPlayers: 6,
    availableSlots: 6,
    publishedAt: new Date().toISOString(),
    url: 'https://arcanecircle.games/games/cmfp2fj6u0001ii04u21oql78'
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

  console.log('📤 Sending game published webhook...');
  console.log('URL:', WEBHOOK_URL);
  console.log('Target Channel ID:', payload.channelId);
  console.log('Game:', payload.game.title);
  console.log('GM:', payload.game.gm.displayName);
  console.log('\nPayload:');
  console.log(JSON.stringify(payload, null, 2));

  // Setup headers
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
    console.log('\n💡 Check your Discord channel for the announcement!');
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

// Validate configuration
if (ANNOUNCEMENT_CHANNEL_ID === 'YOUR_CHANNEL_ID_HERE') {
  console.error('❌ Error: GAME_ANNOUNCEMENT_CHANNEL_ID not configured');
  console.error('Set it via environment variable or update the script');
  process.exit(1);
}

// Run
sendTestWebhook();
