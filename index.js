require('dotenv').config();

const http = require('http');

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Nexus is online');
}).listen(PORT, () => {
  console.log(`Serveur HTTP actif sur le port ${PORT}`);
});

const {
  Client,
  GatewayIntentBits,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', () => {
  console.log(`Nexus est connecté en tant que ${client.user.tag}`);
});

client.user.setPresence({
  status: 'online',
  activities: [
    {
      name: 'la communauté',
      type: 0
    }
  ]
});

client.on('error', (error) => {
  console.error('Erreur Discord :', error);
});

client.on('warn', (message) => {
  console.warn('[WARN]', message);
});

client.on('debug', (message) => {
  console.log('[DEBUG]', message);
});

client.on('shardReady', (id) => {
  console.log('Shard prêt :', id);
});

client.on('shardDisconnect', (event, id) => {
  console.log('Shard déconnecté :', id, event);
});

client.on('shardReconnecting', (id) => {
  console.log('Shard en reconnexion :', id);
});

client.on('shardResume', (id, replayedEvents) => {
  console.log('Shard reconnecté :', id, 'Événements rejoués :', replayedEvents);
});

client.login(process.env.DISCORD_TOKEN);

setInterval(() => {
  console.log('Nexus est toujours actif');
}, 30000);
