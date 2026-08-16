```js
require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits
} = require('discord.js');


// ==============================
// SERVEUR HTTP POUR RENDER
// ==============================

const PORT = process.env.PORT || 3000;

const server = http.createServer(function (req, res) {

  const url = new URL(
    req.url,
    'https://nexus-bpsk.onrender.com'
  );

  // ============================
  // CALLBACK TWITCH
  // ============================

  if (url.pathname === '/twitch/callback') {

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8'
    });

    if (error) {

      res.end(
        '<h1>Erreur Twitch</h1>' +
        '<p>Autorisation Twitch refusée.</p>'
      );

      return;
    }

    if (code) {

      console.log('Code OAuth Twitch reçu.');

      res.end(
        '<h1>Connexion Twitch réussie !</h1>' +
        '<p>Nexus a bien reçu la réponse de Twitch.</p>' +
        '<p>Tu peux fermer cette page.</p>'
      );

      return;
    }

    res.end(
      '<h1>Erreur Twitch</h1>' +
      '<p>Aucun code OAuth reçu.</p>'
    );

    return;
  }


  // ============================
  // PAGE PRINCIPALE RENDER
  // ============================

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Nexus is online');

});


server.listen(PORT, function () {

  console.log(
    'Serveur HTTP actif sur le port ' + PORT
  );

});


// ==============================
// CLIENT DISCORD
// ==============================

const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,

    GatewayIntentBits.GuildMessages,

    GatewayIntentBits.MessageContent,

    GatewayIntentBits.GuildMembers

  ]

});


// ==============================
// BOT PRÊT
// ==============================

client.once('ready', function () {

  console.log(
    'Nexus est connecté en tant que ' +
    client.user.tag
  );


  client.user.setPresence({

    status: 'online',

    activities: [

      {

        name: 'la communauté',

        type: 0

      }

    ]

  });


  console.log(
    'Présence Discord configurée'
  );

});


// ==============================
// ERREURS DISCORD
// ==============================

client.on('error', function (error) {

  console.error(
    'Erreur Discord :',
    error
  );

});


client.on('warn', function (message) {

  console.warn(
    '[WARN]',
    message
  );

});


client.on('debug', function (message) {

  console.log(
    '[DEBUG]',
    message
  );

});


// ==============================
// CONNEXION DISCORD
// ==============================

client.on(
  'shardReady',
  function (id) {

    console.log(
      'Shard prêt :',
      id
    );

  }
);


client.on(
  'shardDisconnect',
  function (event, id) {

    console.log(
      'Shard déconnecté :',
      id,
      event
    );

  }
);


client.on(
  'shardReconnecting',
  function (id) {

    console.log(
      'Shard en reconnexion :',
      id
    );

  }
);


client.on(
  'shardResume',
  function (id, replayedEvents) {

    console.log(
      'Shard reconnecté :',
      id,
      'Événements rejoués :',
      replayedEvents
    );

  }
);


// ==============================
// DIAGNOSTIC
// ==============================

setInterval(
  function () {

    console.log(
      'Nexus est toujours actif'
    );

  },
  30000
);


// ==============================
// VARIABLES TWITCH
// ==============================

console.log(
  'Twitch Client ID présent :',
  !!process.env.TWITCH_CLIENT_ID
);

console.log(
  'Twitch Client Secret présent :',
  !!process.env.TWITCH_CLIENT_SECRET
);

console.log(
  'Twitch Access Token présent :',
  !!process.env.TWITCH_ACCESS_TOKEN
);


// ==============================
// VARIABLES DISCORD
// ==============================

console.log(
  'Discord Token présent :',
  !!process.env.DISCORD_TOKEN
);


// ==============================
// LOGIN DISCORD
// ==============================

console.log(
  'Avant login Discord'
);


client.login(
  process.env.DISCORD_TOKEN
)

.then(
  function () {

    console.log(
      'Login Discord envoyé'
    );

  }
)

.catch(
  function (error) {

    console.error(
      'Erreur login Discord :',
      error
    );

  }
);
```
