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

const server = http.createServer(function (req, res) {
  res.writeHead(200);
  res.end('Nexus is online');
});

server.listen(PORT, function () {
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

client.once('ready', function () {
  console.log('Nexus est connecté en tant que ' + client.user.tag);

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
// Erreurs
// ==============================

client.on('error', function (error) {
  console.error('Erreur Discord :', error);
});

client.on('warn', function (message) {
  console.warn('[WARN]', message);
});

client.on('debug', function (message) {
  console.log('[DEBUG]', message);
});


// ==============================
// Connexion Gateway
// ==============================

client.on('shardReady', function (id) {
  console.log('Shard prêt :', id);
});

client.on('shardDisconnect', function (event, id) {
  console.log('Shard déconnecté :', id, event);
});

client.on('shardReconnecting', function (id) {
  console.log('Shard en reconnexion :', id);
});

client.on('shardResume', function (id, replayedEvents) {
  console.log(
    'Shard reconnecté :',
    id,
    'Événements rejoués :',
    replayedEvents
  );
});


// ==============================
// Diagnostic
// ==============================

setInterval(function () {
  console.log('Nexus est toujours actif');
}, 30000);


// ==============================
// Connexion du bot
// ==============================

console.log(
  'Token présent :',
  !!process.env.DISCORD_TOKEN
);

console.log('Avant login');

client.login(process.env.DISCORD_TOKEN)
  .then(function () {
    console.log('Login envoyé à Discord');
  })
  .catch(function (error) {
    console.error('Erreur login :', error);
  });
```
