```js
require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits,
} = require('discord.js');


// ==============================
// Serveur HTTP pour Render
// ==============================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Nexus is online');
});

server.listen(PORT, () => {
  console.log('Serveur HTTP actif sur le port ' + PORT);
});

// ==============================
// Client Discord
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});


// ==============================
// Connexion Discord
// ==============================

client.once('ready', () => {
  console.log(`Nexus est connecté en tant que ${client.user.tag}`);

  client.user.setPresence({
    status: 'online',
    activities: [
      {
        name: 'la communauté',
        type: 0,
      },
    ],
  });

  console.log('Présence Discord configurée');
});


// ==============================
// Gestion des erreurs
// ==============================

client.on('error', (error) => {
  console.error('Erreur Discord :', error);
});

client.on('warn', (message) => {
  console.warn('[WARN]', message);
});

client.on('debug', (message) => {
  console.log('[DEBUG]', message);
});


// ==============================
// Gestion de la connexion
// ==============================

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
  console.log(
    'Shard reconnecté :',
    id,
    'Événements rejoués :',
    replayedEvents
  );
});


// ==============================
// Heartbeat de diagnostic
// ==============================

setInterval(() => {
  console.log('Nexus est toujours actif');
}, 30000);


// ==============================
// Connexion du bot
// ==============================

console.log('Token présent :', !!process.env.DISCORD_TOKEN);
console.log('Avant login');

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('Login envoyé à Discord');
  })
  .catch((error) => {
    console.error('Erreur login :', error);
  });
```
