require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');


// ========================================
// CONFIGURATION
// ========================================

const PORT =
  process.env.PORT || 3000;

const TWITCH_CLIENT_ID =
  process.env.TWITCH_CLIENT_ID;

const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_CLIENT_SECRET;

const TWITCH_REDIRECT_URI =
  'https://nexus-bpsk.onrender.com/twitch/callback';

const TWITCH_USERNAME =
  'aster_angxl';

const DISCORD_CHANNEL_ID =
  '1532589426297929799';


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
// TWITCH — REFRESH TOKEN
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

    if (data.refresh_token) {

      process.env.TWITCH_REFRESH_TOKEN =
        data.refresh_token;

    }

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
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
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
        'Utilisateur Twitch introuvable :',
        data.message ||
        'Erreur inconnue'
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
      'Erreur récupération ID Twitch :',
      error.message
    );

    return null;
  }
}


// ========================================
// TWITCH — RÉCUPÉRER LE PROFIL
// ========================================

async function getTwitchUser(userId) {

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
        `https://api.twitch.tv/helix/users?id=${userId}`,
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
        'Profil Twitch introuvable.'
      );

      return null;
    }

    return data.data[0];

  } catch (error) {

    console.error(
      'Erreur récupération profil Twitch :',
      error.message
    );

    return null;
  }
}


// ========================================
// TWITCH — RÉCUPÉRER LE LIVE
// ========================================

async function getTwitchStream(userId) {

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
        `https://api.twitch.tv/helix/streams?user_id=${userId}`,
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

    if (!response.ok) {

      console.error(
        'Erreur récupération du live Twitch :',
        data.message ||
        'Erreur inconnue'
      );

      return null;
    }

    if (
      !data.data ||
      !data.data.length
    ) {

      console.error(
        'Aucun live Twitch trouvé.'
      );

      return null;
    }

    return data.data[0];

  } catch (error) {

    console.error(
      'Erreur API Twitch streams :',
      error.message
    );

    return null;
  }
}


// ========================================
// DISCORD — ANNONCE TWITCH
// ========================================

async function sendTwitchLiveAnnouncement(
  stream,
  twitchUser
) {

  try {

    const channel =
      await client.channels.fetch(
        DISCORD_CHANNEL_ID
      );

    if (!channel) {

      console.error(
        'Salon Discord introuvable.'
      );

      return false;
    }

    const gameName =
      stream.game_name ||
      'Jeu non renseigné';

    const twitchUrl =
      `https://www.twitch.tv/${TWITCH_USERNAME}`;

    const profileImage =
      twitchUser &&
      twitchUser.profile_image_url
        ? twitchUser.profile_image_url
        : null;

    const embed =
      new EmbedBuilder()

        .setColor(
          0x9146FF
        )

        .setTitle(
          '🔴 C’EST PARTI !'
        )

        .setURL(
          twitchUrl
        )

        .setDescription(

          '**ASTER ANGXL est maintenant en live** 🟣\n\n' +

          `🎮 **Jeu : ${gameName}**\n\n` +

          'La team, on se retrouve sur le live ? 👀\n' +

          '**Venez nombreux lui faire un coucou !** ❤️'

        )

        .setFooter({
          text:
            'Nexus • Twitch'
        })

        .setTimestamp();

    if (profileImage) {

      embed.setThumbnail(
        profileImage
      );

    }

    await channel.send({

      embeds: [
        embed
      ]

    });

    console.log(
      'Annonce Twitch envoyée sur Discord.'
    );

    return true;

  } catch (error) {

    console.error(
      'Erreur envoi annonce Discord :',
      error.message
    );

    return false;
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
// EVENTSUB — TRAITER UNE NOTIFICATION
// ========================================

async function handleEventSubNotification(
  message,
  userId
) {

  const subscription =
    message.payload &&
    message.payload.subscription;

  if (
    !subscription ||
    subscription.type !== 'stream.online'
  ) {

    return;
  }

  console.log(
    'ASTER ANGXL EST EN LIVE !'
  );

  console.log(
    'Événement Twitch reçu.'
  );

  const stream =
    await getTwitchStream(
      userId
    );

  if (!stream) {

    console.error(
      'Impossible de récupérer les informations du live.'
    );

    return;
  }

  const twitchUser =
    await getTwitchUser(
      userId
    );

  console.log(
    'Jeu :',
    stream.game_name
  );

  await sendTwitchLiveAnnouncement(
    stream,
    twitchUser
  );
}


// ========================================
// TWITCH EVENTSUB — CONNEXION
// ========================================

function connectTwitchEventSub(
  userId,
  websocketUrl =
    'wss://eventsub.wss.twitch.tv/ws'
) {

  console.log(
    'Connexion à Twitch EventSub...'
  );

  const ws =
    new WebSocket(
      websocketUrl
    );

  ws.on(
    'open',
    function () {

      console.log(
        'Connexion Twitch EventSub ouverte.'
      );

    }
  );

  ws.on(
    'message',
    async function (
      rawMessage
    ) {

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

          await handleEventSubNotification(
            message,
            userId
          );

          return;
        }


        // ================================
        // KEEPALIVE
        // ================================

        if (
          messageType ===
          'session_keepalive'
        ) {

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
            message.payload &&
            message.payload.session &&
            message.payload.session.reconnect_url;

          console.log(
            'Twitch demande une reconnexion EventSub.'
          );

          if (reconnectUrl) {

            ws.close();

            setTimeout(
              function () {

                connectTwitchEventSub(
                  userId,
                  reconnectUrl
                );

              },
              1000
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
            'Détails :',
            message.payload &&
            message.payload.subscription
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


  ws.on(
    'error',
    function (error) {

      console.error(
        'Erreur WebSocket Twitch :',
        error.message
      );

    }
  );


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
// SERVEUR HTTP
// ========================================

const server =
  http.createServer(
    async function (
      req,
      res
    ) {

      const url =
        new URL(
          req.url,
          'https://nexus-bpsk.onrender.com'
        );


      // --------------------------------
      // PAGE PRINCIPALE
      // --------------------------------

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


      // --------------------------------
      // CALLBACK TWITCH
      // --------------------------------

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
        // ÉCHANGE CODE → TOKENS
        // ================================

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


      // --------------------------------
      // 404
      // --------------------------------

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


  const tokenReady =
    await refreshTwitchToken();


  if (!tokenReady) {

    console.error(
      'Impossible d initialiser Twitch.'
    );

    return;
  }


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


  connectTwitchEventSub(
    userId
  );

}


// ========================================
// DISCORD — READY
// ========================================

client.once(
  'ready',
  function () {

    console.log(
      'Nexus est connecté en tant que ' +
      client.user.tag
    );

    /*
     * Aucun statut personnalisé.
     *
     * Nexus apparaîtra simplement
     * comme "En ligne" sur Discord.
     */

    console.log(
      'Aucun statut personnalisé configuré.'
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
  function (
    event,
    id
  ) {

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
      error.message
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
