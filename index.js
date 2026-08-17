require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits
} = require('discord.js');


// ========================================
// CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;

const TWITCH_CLIENT_ID =
  process.env.TWITCH_CLIENT_ID;

const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_CLIENT_SECRET;

const TWITCH_REDIRECT_URI =
  'https://nexus-bpsk.onrender.com/twitch/callback';


// ========================================
// SERVEUR HTTP
// ========================================

const server = http.createServer(
  async function (req, res) {

    const url = new URL(
      req.url,
      'https://nexus-bpsk.onrender.com'
    );


    // ====================================
    // PAGE PRINCIPALE
    // ====================================

    if (url.pathname === '/') {

      res.writeHead(200, {
        'Content-Type':
          'text/plain; charset=utf-8'
      });

      res.end('Nexus is online');

      return;
    }


    // ====================================
    // CALLBACK TWITCH
    // ====================================

    if (
      url.pathname ===
      '/twitch/callback'
    ) {

      const code =
        url.searchParams.get('code');

      const error =
        url.searchParams.get('error');

      const errorDescription =
        url.searchParams.get(
          'error_description'
        );


      res.writeHead(200, {
        'Content-Type':
          'text/html; charset=utf-8'
      });


      // ----------------------------------
      // TWITCH A REFUSÉ
      // ----------------------------------

      if (error) {

        console.error(
          'Erreur OAuth Twitch :',
          error,
          errorDescription || ''
        );

        res.end(
          '<h1>Autorisation Twitch refusée</h1>' +
          '<p>Tu peux fermer cette page.</p>'
        );

        return;
      }


      // ----------------------------------
      // PAS DE CODE
      // ----------------------------------

      if (!code) {

        console.error(
          'Aucun code OAuth Twitch reçu.'
        );

        res.end(
          '<h1>Erreur OAuth Twitch</h1>' +
          '<p>Aucun code reçu.</p>'
        );

        return;
      }


      console.log(
        'Code OAuth Twitch reçu.'
      );


      // ----------------------------------
      // ÉCHANGE CODE → ACCESS TOKEN
      // ----------------------------------

      try {

        const tokenResponse =
          await fetch(
            'https://id.twitch.tv/oauth2/token',
            {

              method: 'POST',

              headers: {
                'Content-Type':
                  'application/x-www-form-urlencoded'
              },

              body:
                new URLSearchParams({

                  client_id:
                    TWITCH_CLIENT_ID,

                  client_secret:
                    TWITCH_CLIENT_SECRET,

                  code:
                    code,

                  grant_type:
                    'authorization_code',

                  redirect_uri:
                    TWITCH_REDIRECT_URI

                })

            }
          );


        const tokenData =
          await tokenResponse.json();


        if (!tokenResponse.ok) {

          console.error(
            'Erreur échange token Twitch :',
            tokenData
          );

          res.end(
            '<h1>Erreur Twitch</h1>' +
            '<p>Impossible de récupérer le token.</p>'
          );

          return;
        }


        // --------------------------------
        // TOKEN OBTENU
        // --------------------------------

        process.env.TWITCH_ACCESS_TOKEN =
          tokenData.access_token;


        console.log(
          'Access Token Twitch obtenu.'
        );


        console.log(
          'Expiration Twitch :',
          tokenData.expires_in,
          'secondes'
        );


        // --------------------------------
        // PAGE DE SUCCÈS
        // --------------------------------

        res.end(
          '<h1>Connexion Twitch réussie !</h1>' +
          '<p>Nexus a obtenu son accès Twitch.</p>' +
          '<p>Tu peux fermer cette page.</p>'
        );


      } catch (error) {

        console.error(
          'Erreur OAuth Twitch :',
          error
        );


        res.end(
          '<h1>Erreur</h1>' +
          '<p>Une erreur est survenue pendant la connexion Twitch.</p>'
        );

      }


      return;
    }


    // ====================================
    // AUTRES ROUTES
    // ====================================

    res.writeHead(404, {
      'Content-Type':
        'text/plain; charset=utf-8'
    });

    res.end('Not found');

  }
);


// ========================================
// DÉMARRAGE SERVEUR
// ========================================

server.listen(
  PORT,
  function () {

    console.log(
      'Serveur HTTP actif sur le port ' +
      PORT
    );

  }
);


// ========================================
// CLIENT DISCORD
// ========================================

const client = new Client({

  intents: [

    GatewayIntentBits.Guilds,

    GatewayIntentBits.GuildMessages,

    GatewayIntentBits.MessageContent,

    GatewayIntentBits.GuildMembers

  ]

});


// ========================================
// BOT PRÊT
// ========================================

client.once(
  'ready',
  function () {

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

  }
);


// ========================================
// ERREURS DISCORD
// ========================================

client.on(
  'error',
  function (error) {

    console.error(
      'Erreur Discord :',
      error
    );

  }
);


client.on(
  'warn',
  function (message) {

    console.warn(
      '[WARN]',
      message
    );

  }
);


// ========================================
// DEBUG DISCORD
// ========================================

client.on(
  'debug',
  function (message) {

    // Évite d'afficher des informations
    // sensibles dans les logs.

    console.log(
      '[DEBUG]',
      message
    );

  }
);


// ========================================
// SHARD
// ========================================

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
  function (
    id,
    replayedEvents
  ) {

    console.log(
      'Shard reconnecté :',
      id,
      'Événements rejoués :',
      replayedEvents
    );

  }
);


// ========================================
// DIAGNOSTIC
// ========================================

console.log(
  'Discord Token présent :',
  !!process.env.DISCORD_TOKEN
);

console.log(
  'Twitch Client ID présent :',
  !!TWITCH_CLIENT_ID
);

console.log(
  'Twitch Client Secret présent :',
  !!TWITCH_CLIENT_SECRET
);

console.log(
  'Twitch Access Token présent :',
  !!process.env.TWITCH_ACCESS_TOKEN
);


// ========================================
// CONNEXION DISCORD
// ========================================

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


// ========================================
// HEARTBEAT NEXUS
// ========================================

setInterval(
  function () {

    console.log(
      'Nexus est toujours actif'
    );

  },
  30000
);
