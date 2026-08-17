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

async function refreshTwitchToken() {
  const refreshToken = process.env.TWITCH_REFRESH_TOKEN;

  if (!refreshToken) {
    console.error('Refresh Token Twitch absent.');
    return false;
  }

  try {
    const response = await fetch(
      'https://id.twitch.tv/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        'Erreur renouvellement Twitch :',
        data.message || 'Erreur inconnue'
      );

      return false;
    }

    process.env.TWITCH_ACCESS_TOKEN =
      data.access_token;

    console.log(
      'Access Token Twitch renouvelé avec succès.'
    );

    return true;

  } catch (error) {
    console.error(
      'Erreur connexion Twitch :',
      error.message
    );

    return false;
  }
}

// Code temporaire pour récupérer le refresh token.
// À SUPPRIMER après configuration de Render.
const TWITCH_SETUP_KEY =
  'nexus-twitch-setup-2026';


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


      // ----------------------------------
      // TWITCH A REFUSÉ
      // ----------------------------------

      if (error) {

        console.error(
          'Erreur OAuth Twitch :',
          error,
          errorDescription || ''
        );

        res.writeHead(200, {
          'Content-Type':
            'text/html; charset=utf-8'
        });

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

        res.writeHead(400, {
          'Content-Type':
            'text/html; charset=utf-8'
        });

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
      // ÉCHANGE CODE → TOKEN
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

          res.writeHead(500, {
            'Content-Type':
              'text/html; charset=utf-8'
          });

          res.end(
            '<h1>Erreur Twitch</h1>' +
            '<p>Impossible de récupérer le token.</p>'
          );

          return;
        }


        // --------------------------------
        // TOKENS EN MÉMOIRE
        // --------------------------------

        process.env.TWITCH_ACCESS_TOKEN =
          tokenData.access_token;

        process.env.TWITCH_REFRESH_TOKEN =
          tokenData.refresh_token;


        console.log(
          'Access Token Twitch obtenu.'
        );

        console.log(
          'Refresh Token Twitch reçu :',
          !!tokenData.refresh_token
        );

        console.log(
          'Expiration Twitch :',
          tokenData.expires_in,
          'secondes'
        );


        // --------------------------------
        // SUCCÈS
        // --------------------------------

        res.writeHead(200, {
          'Content-Type':
            'text/html; charset=utf-8'
        });

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

        res.writeHead(500, {
          'Content-Type':
            'text/html; charset=utf-8'
        });

        res.end(
          '<h1>Erreur</h1>' +
          '<p>Une erreur est survenue.</p>'
        );

      }

      return;
    }

    // ====================================
    // ROUTE INEXISTANTE
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

refreshTwitchToken();

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

console.log(
  'Twitch Refresh Token présent :',
  !!process.env.TWITCH_REFRESH_TOKEN
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
// HEARTBEAT
// ========================================

setInterval(
  function () {

    console.log(
      'Nexus est toujours actif'
    );

  },
  30000
);
