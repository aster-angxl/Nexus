require('dotenv').config();

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

