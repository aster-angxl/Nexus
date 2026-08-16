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

client.on('error', (error) => {
  console.error('Erreur Discord :', error);
});

client.login(process.env.DISCORD_TOKEN);

