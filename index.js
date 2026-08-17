require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');

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

const TWITCH_USERNAME =
  'aster_angxl';


// ========================================
// TWITCH — RENOUVELLEMENT DU TOKEN
// ========================================

async function refreshTwitchToken() {

  const refreshToken =
    process.env.TWITCH_REFRESH_TOKEN;

  if (!refreshToken) {

    console.error(
      'Refresh Token Twitch absent.'
    );

    return false;
  }


  try {

    const response =
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

              grant_type:
                'refresh_token',

              refresh_token:
                refreshToken

            })

        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      console.error(
        'Erreur renouvellement Twitch :',
        data.message ||
        'Erreur inconnue'
      );

      return false;
    }


    process.env.TWITCH_ACCESS_TOKEN =
      data.access_token;


    /*
     * Twitch peut fournir un nouveau
     * refresh token.
     *
     * On ne l'affiche jamais dans les logs.
     *
     * Pour l'instant, le refresh token
     * enregistré dans Render reste notre
     * valeur persistante.
     */

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


// ========================================
// TWITCH — RÉCUPÉRER L'ID UTILISATEUR
// ========================================

async function getTwitchUserId(username) {

  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;


  if (!accessToken) {

    console.error(
      'Access Token Twitch absent.'
    );

    return null;
  }


  try {

    const response =
      await fetch(
        'https://api.twitch.tv/helix/users?login=' +
        encodeURIComponent(username),
        {

          headers: {

            'Client-ID':
              TWITCH_CLIENT_ID,

            'Authorization':
              `Bearer ${accessToken}`

          }

        }
      );


    const data =
      await response.json();


    if (
      !response.ok ||
      !data.data ||
      !data.data.length
    ) {

      console.error(
        'Impossible de trouver le compte Twitch :',
        data.message ||
        'Utilisateur introuvable'
      );

      return null;
    }


    const user =
      data.data[0];


    console.log(
      'Compte Twitch trouvé :',
      user.login
    );


    return user.id;


  } catch (error) {

    console.error(
      'Erreur récupération utilisateur Twitch :',
      error.message
    );

    return null;
  }
}


// ========================================
// TWITCH EVENTSUB — SUBSCRIPTION
// ========================================

async function createStreamOnlineSubscription(
  sessionId,
  userId
) {

  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;


  if (!accessToken) {

    console.error(
      'Access Token Twitch absent pour EventSub.'
    );

    return false;
  }


  try {

    const response =
      await fetch(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {

          method: 'POST',

          headers: {

            'Client-ID':
              TWITCH_CLIENT_ID,

            'Authorization':
              `Bearer ${accessToken}`,

            'Content-Type':
              'application/json'

          },

          body:
            JSON.stringify({

              type:
                'stream.online',

              version:
                '1',

              condition: {

                broadcaster_user_id:
                  userId

              },

              transport: {

                method:
                  'websocket',

                session_id:
                  sessionId

              }

            })

        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      console.error(
        'Erreur création subscription EventSub :',
        data.message ||
        'Erreur inconnue'
      );

      return false;
    }


    console.log(
      'Subscription EventSub créée !'
    );

    console.log(
      'Type : stream.online'
    );


    return true;


  } catch (error) {

    console.error(
      'Erreur EventSub :',
      error.message
    );

    return false;
  }
}


// ========================================
// TWITCH EVENTSUB — WEBSOCKET
// ========================================

function connectTwitchEventSub(userId) {

  console.log(
    'Connexion à Twitch EventSub...'
  );


  const ws =
    new WebSocket(
      'wss://eventsub.wss.twitch.tv/ws'
    );


  // --------------------------------------
  // CONNEXION OUVERTE
  // --------------------------------------

  ws.on(
    'open',
    function () {

      console.log(
        'Connexion Twitch EventSub ouverte.'
      );

    }
  );


  // --------------------------------------
  // MESSAGE
  // --------------------------------------

  ws.on(
    'message',
    async function (rawMessage) {

      try {

        const message =
          JSON.parse(
            rawMessage.toString()
          );


        const metadata =
          message.metadata || {};


        const messageType =
          metadata.message_type;


        console.log(
          'EventSub message :',
          messageType
        );


        // ================================
        // SESSION WELCOME
        // ================================

        if (
          messageType ===
          'session_welcome'
        ) {

          const sessionId =
            message.payload.session.id;


          console.log(
            'Session EventSub reçue.'
          );


          console.log(
            'Session ID EventSub reçu.'
          );


          await createStreamOnlineSubscription(
            sessionId,
            userId
          );


          return;
        }


        // ================================
        // NOTIFICATION
        // ================================

        if (
          messageType ===
          'notification'
        ) {

          const subscription =
            message.payload.subscription;


          const event =
            message.payload.event;


          if (
            subscription &&
            subscription.type ===
            'stream.online'
          ) {

            console.log(
              'ASTER ANGXL EST EN LIVE !'
            );


            console.log(
              'Événement Twitch reçu.'
            );


            if (event) {

              console.log(
                'Broadcaster :',
                event.broadcaster_user_name
              );

              console.log(
                'Broadcaster ID :',
                event.broadcaster_user_id
              );

            }


            /*
             * Plus tard :
             *
             * - récupérer les informations
             *   du live
             * - récupérer le jeu
             * - récupérer le titre
             * - envoyer le message Discord
             */

          }


          return;
        }


        // ================================
        // RECONNECT
        // ================================

        if (
          messageType ===
          'session_reconnect'
        ) {

          const reconnectUrl =
            message.payload.session
              .reconnect_url;


          console.log(
            'Twitch demande une reconnexion EventSub.'
          );


          if (reconnectUrl) {

            ws.close();

            connectTwitchEventSubWithUrl(
              userId,
              reconnectUrl
            );

          }


          return;
        }


        // ================================
        // REVOCATION
        // ================================

        if (
          messageType ===
          'revocation'
        ) {

          console.error(
            'Subscription EventSub révoquée.'
          );


          console.error(
            'Raison :',
            message.payload
              .subscription
              .status
          );


          return;
        }


      } catch (error) {

        console.error(
          'Erreur traitement EventSub :',
          error.message
        );

      }

    }
  );


  // --------------------------------------
  // ERREUR WEBSOCKET
  // --------------------------------------

  ws.on(
    'error',
    function (error) {

      console.error(
        'Erreur WebSocket Twitch :',
        error.message
      );

    }
  );


  // --------------------------------------
  // FERMETURE
  // --------------------------------------

  ws.on(
    'close',
    function () {

      console.log(
        'Connexion Twitch EventSub fermée.'
      );

    }
  );


  return ws;
}


// ========================================
// EVENTSUB — RECONNEXION
// ========================================

function connectTwitchEventSubWithUrl(
  userId,
  reconnectUrl
) {

  console.log(
    'Connexion à la nouvelle session EventSub...'
  );


  const ws =
    new WebSocket(
      reconnectUrl
    );


  ws.on(
    'open',
    function () {

      console.log(
        'Nouvelle connexion EventSub ouverte.'
      );

    }
  );


  ws.on(
    'message',
    async function (rawMessage) {

      try {

        const message =
          JSON.parse(
            rawMessage.toString()
          );


        const messageType =
          message.metadata &&
          message.metadata.message_type;


        console.log(
          'EventSub message :',
          messageType
        );


        if (
          messageType ===
          'session_welcome'
        ) {

          console.log(
            'Nouvelle session EventSub reçue.'
          );


          /*
           * La subscription de l'ancienne
           * session est transférée vers la
           * nouvelle session.
           *
           * On ne crée donc pas une seconde
           * subscription ici.
           */

          return;
        }


        if (
          messageType ===
          'notification'
        ) {

          const subscription =
            message.payload.subscription;


          const event =
            message.payload.event;


          if (
            subscription &&
            subscription.type ===
            'stream.online'
          ) {

            console.log(
              'ASTER ANGXL EST EN LIVE !'
            );


            console.log(
              'Événement Twitch reçu.'
            );


            if (event) {

              console.log(
                'Broadcaster :',
                event.broadcaster_user_name
              );

            }

          }

          return;
        }


      } catch (error) {

        console.error(
          'Erreur reconnexion EventSub :',
          error.message
        );

      }

    }
  );


  ws.on(
    'error',
    function (error) {

      console.error(
        'Erreur WebSocket EventSub :',
        error.message
      );

    }
  );


  ws.on(
    'close',
    function () {

      console.log(
        'Nouvelle connexion EventSub fermée.'
      );

    }
  );
}


// ========================================
// SERVEUR HTTP
// ========================================

const server =
  http.createServer(
    async function (req, res) {

      const url =
        new URL(
          req.url,
          'https://nexus-bpsk.onrender.com'
        );


      // ----------------------------------
      // PAGE PRINCIPALE
      // ----------------------------------

      if (
        url.pathname === '/'
      ) {

        res.writeHead(
          200,
          {
            'Content-Type':
              'text/plain; charset=utf-8'
          }
        );


        res.end(
          'Nexus is online'
        );


        return;
      }


      // ----------------------------------
      // CALLBACK TWITCH
      // ----------------------------------

      if (
        url.pathname ===
        '/twitch/callback'
      ) {

        const code =
          url.searchParams.get(
            'code'
          );


        const error =
          url.searchParams.get(
            'error'
          );


        const errorDescription =
          url.searchParams.get(
            'error_description'
          );


        // ================================
        // REFUS
        // ================================

        if (error) {

          console.error(
            'Erreur OAuth Twitch :',
            error,
            errorDescription || ''
          );


          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            '<h1>Autorisation Twitch refusée</h1>' +
            '<p>Tu peux fermer cette page.</p>'
          );


          return;
        }


        // ================================
        // CODE ABSENT
        // ================================

        if (!code) {

          res.writeHead(
            400,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
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


        // ================================
        // ÉCHANGE CODE
        // ================================

        try {

          const tokenResponse =
            await fetch(
              'https://id.twitch.tv/oauth2/token',
              {

                method:
                  'POST',

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
              tokenData.message ||
              'Erreur inconnue'
            );


            res.writeHead(
              500,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );


            res.end(
              '<h1>Erreur Twitch</h1>' +
              '<p>Impossible de récupérer le token.</p>'
            );


            return;
          }


          // ==============================
          // TOKENS EN MÉMOIRE
          // ==============================

          process.env.TWITCH_ACCESS_TOKEN =
            tokenData.access_token;


          if (
            tokenData.refresh_token
          ) {

            process.env.TWITCH_REFRESH_TOKEN =
              tokenData.refresh_token;

          }


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


          // ==============================
          // SUCCÈS
          // ==============================

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            '<h1>Connexion Twitch réussie !</h1>' +
            '<p>Nexus a obtenu son accès Twitch.</p>' +
            '<p>Tu peux fermer cette page.</p>'
          );


        } catch (error) {

          console.error(
            'Erreur OAuth Twitch :',
            error.message
          );


          res.writeHead(
            500,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            '<h1>Erreur</h1>' +
            '<p>Une erreur est survenue.</p>'
          );

        }


        return;
      }


      // ----------------------------------
      // ROUTE INEXISTANTE
      // ----------------------------------

      res.writeHead(
        404,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );


      res.end(
        'Not found'
      );

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
// INITIALISATION TWITCH
// ========================================

async function initializeTwitch() {

  console.log(
    'Initialisation Twitch...'
  );


  // --------------------------------------
  // RENOUVELER ACCESS TOKEN
  // --------------------------------------

  const tokenReady =
    await refreshTwitchToken();


  if (!tokenReady) {

    console.error(
      'Impossible d initialiser Twitch.'
    );

    return;
  }


  // --------------------------------------
  // RÉCUPÉRER ID
  // --------------------------------------

  const userId =
    await getTwitchUserId(
      TWITCH_USERNAME
    );


  if (!userId) {

    console.error(
      'Impossible de récupérer l ID Twitch.'
    );

    return;
  }


  console.log(
    'ID Twitch de ' +
    TWITCH_USERNAME +
    ' :',
    userId
  );


  // --------------------------------------
  // EVENTSUB
  // --------------------------------------

  connectTwitchEventSub(
    userId
  );

}


// ========================================
// CLIENT DISCORD
// ========================================

const client =
  new Client({

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

      status:
        'online',

      activities: [

        {

          name:
            'la communauté',

          type:
            0

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
// LANCEMENT TWITCH
// ========================================

initializeTwitch();


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
