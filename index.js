require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  Status
} = require('discord.js');

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = Number(process.env.PORT || 3000);

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN;

const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID;

const TWITCH_CLIENT_ID =
  process.env.TWITCH_CLIENT_ID;

const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_CLIENT_SECRET;

const TWITCH_USERNAME =
  process.env.TWITCH_USERNAME ||
  'aster_angxl';

const TWITCH_REDIRECT_URI =
  process.env.TWITCH_REDIRECT_URI ||
  'https://nexus-bpsk.onrender.com/twitch/callback';

const TWITCH_CHAT_REDIRECT_URI =
  process.env.TWITCH_CHAT_REDIRECT_URI ||
  'https://nexus-bpsk.onrender.com/twitch/chat/callback';

const DISCORD_INVITE =
  process.env.DISCORD_INVITE || '';

const STREAM_CHANNEL_ID =
  process.env.STREAM_CHANNEL_ID ||
  '1532589426297929799';

const SANCTION_CHANNEL_ID =
  process.env.SANCTION_CHANNEL_ID ||
  '1538498193728475197';

// ============================================================
// TWITCH TOKENS
// ============================================================
//
// API / EventSub
//
// Tu peux utiliser un token existant avec :
// TWITCH_ACCESS_TOKEN
// TWITCH_REFRESH_TOKEN
//
// CHAT
//
// Le chat utilise maintenant :
// TWITCH_CHAT_ACCESS_TOKEN
// TWITCH_CHAT_REFRESH_TOKEN
//
// Le token Chat est obtenu automatiquement via OAuth.
// ============================================================

let twitchAccessToken =
  process.env.TWITCH_ACCESS_TOKEN || '';

let twitchRefreshToken =
  process.env.TWITCH_REFRESH_TOKEN || '';

let twitchChatAccessToken =
  process.env.TWITCH_CHAT_ACCESS_TOKEN || '';

let twitchChatRefreshToken =
  process.env.TWITCH_CHAT_REFRESH_TOKEN || '';

// ============================================================
// AUTO MODÉRATION
// ============================================================

const GENERAL_INSULT_THRESHOLD = 3;

const DETECTION_WINDOW =
  60 * 1000;

const SANCTION_COOLDOWN =
  5 * 60 * 1000;

const GENERAL_INSULTS = [
  'pute',
  'putain',
  'salope',
  'connard',
  'connasse',
  'encule',
  'enculé',
  'enculer',
  'merde',
  'bordel',
  'batard',
  'bâtard',
  'batarde',
  'bâtarde',
  'fdp',
  'ntm',
  'nique',
  'niquer',
  'con',
  'conne',
  'abruti',
  'abrutie',
  'idiot',
  'idiote',
  'imbecile',
  'imbécile',
  'tg',
  'ta gueule'
];

const SENSITIVE_PATTERNS = [
  'pédé',
  'pede',
  'pédale',
  'pedale',
  'tapette',
  'sale gay',
  'sale lesbienne',
  'sale noir',
  'sale arabe',
  'sale asiat',
  'sale blanc',
  'gros porc',
  'grosse vache',
  'gros tas',
  'mongol',
  'mongole',
  'trisomique'
];

// ============================================================
// ÉTAT GLOBAL
// ============================================================

let shuttingDown = false;
let shutdownStarted = false;

let discordReadyAt = null;

let twitchUserId = null;
let twitchUser = null;

let lastAnnouncedStreamId = null;

// ============================================================
// EVENTSUB
// ============================================================

let twitchEventSubSocket = null;
let twitchEventSubSessionId = null;
let twitchReconnectTimer = null;
let twitchReconnectAttempt = 0;

// ============================================================
// TWITCH CHAT
// ============================================================

let twitchChatSocket = null;
let twitchChatReconnectTimer = null;
let twitchChatReconnectAttempt = 0;
let twitchChatAuthenticated = false;

// ============================================================
// MÉMOIRE
// ============================================================

const detectionTracker =
  new Map();

const sanctionCooldowns =
  new Map();

const sanctionRequests =
  new Map();

// ============================================================
// DISCORD
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ============================================================
// OUTILS
// ============================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDiscordStatusName(status) {
  const entry =
    Object.entries(Status).find(
      ([, value]) => value === status
    );

  return entry
    ? entry[0]
    : `UNKNOWN(${status})`;
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /[_\-.,!?;:/\\()[\]{}"'`]+/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWord(content, word) {
  const normalizedContent =
    normalizeText(content);

  const normalizedWord =
    normalizeText(word);

  if (!normalizedWord) {
    return false;
  }

  const escaped =
    normalizedWord.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  const regex =
    new RegExp(
      `(^|\\s)${escaped}(?=\\s|$)`,
      'i'
    );

  return regex.test(
    normalizedContent
  );
}

// ============================================================
// TWITCH TOKEN HEADERS
// ============================================================

function twitchApiHeaders() {
  return {
    'Client-ID':
      TWITCH_CLIENT_ID,

    'Authorization':
      `Bearer ${twitchAccessToken}`
  };
}

// ============================================================
// VALIDATION TOKEN
// ============================================================

async function validateTwitchToken(
  token
) {
  if (
    !TWITCH_CLIENT_ID ||
    !token
  ) {
    return null;
  }

  try {
    const response =
      await fetch(
        'https://id.twitch.tv/oauth2/validate',
        {
          headers: {
            Authorization:
              `OAuth ${token}`
          }
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return null;
    }

    return data;

  } catch (error) {
    console.error(
      '❌ Validation Twitch :',
      error.message
    );

    return null;
  }
}

// ============================================================
// REFRESH TOKEN API TWITCH
// ============================================================

async function refreshTwitchApiToken() {
  if (
    !twitchRefreshToken ||
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET
  ) {
    console.warn(
      '⚠️ Refresh Twitch API impossible.'
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
                twitchRefreshToken
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Refresh Twitch API :',
        data
      );

      return false;
    }

    if (!data.access_token) {
      return false;
    }

    twitchAccessToken =
      data.access_token;

    process.env.TWITCH_ACCESS_TOKEN =
      twitchAccessToken;

    if (data.refresh_token) {
      twitchRefreshToken =
        data.refresh_token;

      process.env.TWITCH_REFRESH_TOKEN =
        twitchRefreshToken;

      console.warn(
        '⚠️ Nouveau TWITCH_REFRESH_TOKEN reçu.'
      );

      console.warn(
        '⚠️ Mets-le à jour dans Render.'
      );
    }

    console.log(
      '✅ Access Token Twitch API renouvelé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur refresh Twitch API :',
      error.message
    );

    return false;
  }
}

// ============================================================
// REFRESH TOKEN CHAT
// ============================================================

async function refreshTwitchChatToken() {
  if (
    !twitchChatRefreshToken ||
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET
  ) {
    console.warn(
      '⚠️ Aucun TWITCH_CHAT_REFRESH_TOKEN.'
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
                twitchChatRefreshToken
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Refresh Twitch Chat :',
        data
      );

      return false;
    }

    if (!data.access_token) {
      console.error(
        '❌ Aucun access token Chat reçu.'
      );

      return false;
    }

    twitchChatAccessToken =
      data.access_token;

    process.env.TWITCH_CHAT_ACCESS_TOKEN =
      twitchChatAccessToken;

    if (data.refresh_token) {
      twitchChatRefreshToken =
        data.refresh_token;

      process.env.TWITCH_CHAT_REFRESH_TOKEN =
        twitchChatRefreshToken;

      console.warn(
        '⚠️ Nouveau TWITCH_CHAT_REFRESH_TOKEN reçu.'
      );

      console.warn(
        '⚠️ Mets-le à jour dans Render.'
      );
    }

    console.log(
      '✅ Token Twitch Chat renouvelé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur refresh Twitch Chat :',
      error.message
    );

    return false;
  }
}

// ============================================================
// TWITCH USER ID
// ============================================================

async function getTwitchUserId(
  username
) {
  if (!twitchAccessToken) {
    console.error(
      '❌ TWITCH_ACCESS_TOKEN absent.'
    );

    return null;
  }

  try {
    const response =
      await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
        {
          headers:
            twitchApiHeaders()
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Twitch users :',
        data
      );

      return null;
    }

    if (
      !data.data ||
      !data.data.length
    ) {
      console.error(
        '❌ Twitch utilisateur introuvable.'
      );

      return null;
    }

    return data.data[0].id;

  } catch (error) {
    console.error(
      '❌ Erreur Twitch user :',
      error.message
    );

    return null;
  }
}

// ============================================================
// TWITCH USER
// ============================================================

async function getTwitchUser(
  userId
) {
  if (!twitchAccessToken) {
    return null;
  }

  try {
    const response =
      await fetch(
        `https://api.twitch.tv/helix/users?id=${encodeURIComponent(userId)}`,
        {
          headers:
            twitchApiHeaders()
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return null;
    }

    if (
      !data.data ||
      !data.data.length
    ) {
      return null;
    }

    return data.data[0];

  } catch (error) {
    console.error(
      '❌ Erreur profil Twitch :',
      error.message
    );

    return null;
  }
}

// ============================================================
// TWITCH STREAM
// ============================================================

async function getTwitchStream(
  userId
) {
  if (!twitchAccessToken) {
    return null;
  }

  try {
    const response =
      await fetch(
        `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(userId)}`,
        {
          headers:
            twitchApiHeaders()
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Twitch streams :',
        data
      );

      return null;
    }

    if (
      !data.data ||
      !data.data.length
    ) {
      return null;
    }

    return data.data[0];

  } catch (error) {
    console.error(
      '❌ Erreur Twitch stream :',
      error.message
    );

    return null;
  }
}

// ============================================================
// AUTO MODÉRATION
// ============================================================

function detectModeration(
  content
) {
  let general = false;
  let sensitive = false;

  for (
    const word
    of GENERAL_INSULTS
  ) {
    if (
      containsWord(
        content,
        word
      )
    ) {
      general = true;
      break;
    }
  }

  for (
    const word
    of SENSITIVE_PATTERNS
  ) {
    if (
      containsWord(
        content,
        word
      )
    ) {
      sensitive = true;
      break;
    }
  }

  return {
    general,
    sensitive
  };
}

// ============================================================
// TRACKING
// ============================================================

function registerDetection(
  userId,
  type
) {
  const now =
    Date.now();

  let data =
    detectionTracker.get(
      userId
    );

  if (!data) {
    data = {
      general: [],
      sensitive: []
    };
  }

  data.general =
    data.general.filter(
      timestamp =>
        now - timestamp <
        DETECTION_WINDOW
    );

  data.sensitive =
    data.sensitive.filter(
      timestamp =>
        now - timestamp <
        DETECTION_WINDOW
    );

  if (type === 'general') {
    data.general.push(now);
  }

  if (type === 'sensitive') {
    data.sensitive.push(now);
  }

  detectionTracker.set(
    userId,
    data
  );

  return data;
}

// ============================================================
// ANNONCE LIVE DISCORD
// ============================================================

async function sendTwitchLiveAnnouncement(
  stream,
  user
) {
  try {
    const channel =
      await client.channels.fetch(
        STREAM_CHANNEL_ID
      );

    if (!channel) {
      console.error(
        '❌ Salon Twitch introuvable.'
      );

      return false;
    }

    const gameName =
      stream.game_name ||
      'Jeu non renseigné';

    const twitchUrl =
      `https://www.twitch.tv/${TWITCH_USERNAME}`;

    const embed =
      new EmbedBuilder()
        .setColor(0x9146FF)
        .setTitle(
          '🔴 ASTER ANGXL EST EN LIVE !'
        )
        .setURL(twitchUrl)
        .setDescription(
          `Il vient de lancer un live sur **${gameName}** 🎮\n\n` +
          `Passe lui faire un coucou 👀\n\n` +
          `👉 [**Regarder le live**](${twitchUrl})`
        )
        .setFooter({
          text:
            'Nexus • Twitch'
        })
        .setTimestamp();

    if (
      user &&
      user.profile_image_url
    ) {
      embed.setThumbnail(
        user.profile_image_url
      );
    }

    await channel.send({
      embeds: [embed]
    });

    console.log(
      '✅ Annonce Twitch envoyée sur Discord.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur annonce Twitch :',
      error.message
    );

    return false;
  }
}

// ============================================================
// EVENTSUB SUBSCRIPTION
// ============================================================

async function createStreamOnlineSubscription(
  sessionId,
  userId
) {
  try {
    const response =
      await fetch(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          method: 'POST',

          headers: {
            ...twitchApiHeaders(),

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
        '❌ EventSub :',
        data
      );

      return false;
    }

    console.log(
      '✅ Subscription EventSub créée.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ EventSub subscription :',
      error.message
    );

    return false;
  }
}

// ============================================================
// EVENTSUB RECONNECT
// ============================================================

function clearTwitchReconnectTimer() {
  if (
    twitchReconnectTimer
  ) {
    clearTimeout(
      twitchReconnectTimer
    );

    twitchReconnectTimer =
      null;
  }
}

function scheduleTwitchReconnect() {
  if (shuttingDown) {
    return;
  }

  if (twitchReconnectTimer) {
    return;
  }

  twitchReconnectAttempt++;

  const delay =
    Math.min(
      5000 *
        Math.pow(
          2,
          twitchReconnectAttempt - 1
        ),
      60000
    );

  console.warn(
    `⏳ Reconnexion EventSub dans ${Math.round(
      delay / 1000
    )}s.`
  );

  twitchReconnectTimer =
    setTimeout(
      async () => {
        twitchReconnectTimer =
          null;

        if (
          shuttingDown ||
          !twitchUserId
        ) {
          return;
        }

        await connectTwitchEventSub(
          twitchUserId
        );
      },
      delay
    );
}

// ============================================================
// EVENTSUB CONNECT
// ============================================================

async function connectTwitchEventSub(
  userId,
  websocketUrl =
    'wss://eventsub.wss.twitch.tv/ws'
) {
  if (
    shuttingDown ||
    !userId
  ) {
    return null;
  }

  if (
    twitchEventSubSocket &&
    (
      twitchEventSubSocket.readyState ===
        WebSocket.OPEN ||

      twitchEventSubSocket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return twitchEventSubSocket;
  }

  clearTwitchReconnectTimer();

  console.log(
    '🔌 Connexion Twitch EventSub...'
  );

  const ws =
    new WebSocket(
      websocketUrl
    );

  twitchEventSubSocket =
    ws;

  ws.on(
    'open',
    () => {
      console.log(
        '✅ Twitch EventSub connecté.'
      );
    }
  );

  ws.on(
    'message',
    async rawMessage => {
      try {
        const message =
          JSON.parse(
            rawMessage.toString()
          );

        const metadata =
          message.metadata ||
          {};

        const type =
          metadata.message_type;

        if (
          type ===
          'session_welcome'
        ) {
          const session =
            message.payload &&
            message.payload.session;

          if (!session) {
            return;
          }

          twitchEventSubSessionId =
            session.id;

          twitchReconnectAttempt =
            0;

          console.log(
            '✅ Session EventSub reçue.'
          );

          await createStreamOnlineSubscription(
            session.id,
            userId
          );

          return;
        }

        if (
          type ===
          'session_keepalive'
        ) {
          return;
        }

        if (
          type ===
          'session_reconnect'
        ) {
          const reconnectUrl =
            message.payload &&
            message.payload.session &&
            message.payload.session
              .reconnect_url;

          if (!reconnectUrl) {
            return;
          }

          console.log(
            '🔄 Twitch demande une reconnexion EventSub.'
          );

          setTimeout(
            async () => {
              if (!shuttingDown) {
                await connectTwitchEventSub(
                  userId,
                  reconnectUrl
                );
              }
            },
            500
          );

          return;
        }

        if (
          type ===
          'revocation'
        ) {
          console.error(
            '🔴 Subscription EventSub révoquée.'
          );

          return;
        }

        if (
          type !==
          'notification'
        ) {
          return;
        }

        const payload =
          message.payload ||
          {};

        const subscription =
          payload.subscription;

        const event =
          payload.event;

        if (
          !subscription ||
          !event
        ) {
          return;
        }

        if (
          subscription.type !==
          'stream.online'
        ) {
          return;
        }

        const streamId =
          event.id;

        if (
          lastAnnouncedStreamId ===
          streamId
        ) {
          return;
        }

        console.log(
          '🔴 Twitch stream.online reçu.'
        );

        let stream = null;

        for (
          let attempt = 1;
          attempt <= 5;
          attempt++
        ) {
          stream =
            await getTwitchStream(
              userId
            );

          if (stream) {
            break;
          }

          await sleep(2000);
        }

        if (!stream) {
          console.error(
            '❌ Impossible de récupérer le live Twitch.'
          );

          return;
        }

        const user =
          await getTwitchUser(
            userId
          );

        const sent =
          await sendTwitchLiveAnnouncement(
            stream,
            user
          );

        if (sent) {
          lastAnnouncedStreamId =
            streamId;
        }

      } catch (error) {
        console.error(
          '❌ EventSub message :',
          error.message
        );
      }
    }
  );

  ws.on(
    'error',
    error => {
      console.error(
        '❌ EventSub WebSocket :',
        error.message
      );
    }
  );

  ws.on(
    'close',
    (code, reason) => {
      if (
        twitchEventSubSocket ===
        ws
      ) {
        twitchEventSubSocket =
          null;

        twitchEventSubSessionId =
          null;
      }

      console.warn(
        `🟠 EventSub fermé. Code=${code} Reason=${
          reason
            ? reason.toString()
            : 'aucune'
        }`
      );

      if (!shuttingDown) {
        scheduleTwitchReconnect();
      }
    }
  );

  return ws;
}

// ============================================================
// TWITCH CHAT RECONNECT
// ============================================================

function clearTwitchChatReconnectTimer() {
  if (
    twitchChatReconnectTimer
  ) {
    clearTimeout(
      twitchChatReconnectTimer
    );

    twitchChatReconnectTimer =
      null;
  }
}

function scheduleTwitchChatReconnect() {
  if (shuttingDown) {
    return;
  }

  if (twitchChatReconnectTimer) {
    return;
  }

  twitchChatReconnectAttempt++;

  const delay =
    Math.min(
      5000 *
        Math.pow(
          2,
          twitchChatReconnectAttempt - 1
        ),
      60000
    );

  console.warn(
    `⏳ Reconnexion Twitch Chat dans ${Math.round(
      delay / 1000
    )}s.`
  );

  twitchChatReconnectTimer =
    setTimeout(
      async () => {
        twitchChatReconnectTimer =
          null;

        if (!shuttingDown) {
          await connectTwitchChat();
        }
      },
      delay
    );
}

// ============================================================
// TWITCH CHAT SEND
// ============================================================

function sendTwitchChatMessage(
  text
) {
  if (
    !twitchChatSocket ||
    twitchChatSocket.readyState !==
      WebSocket.OPEN ||
    !twitchChatAuthenticated
  ) {
    console.warn(
      '⚠️ Twitch Chat non connecté.'
    );

    return false;
  }

  const message =
    String(text || '')
      .replace(/\r/g, '')
      .replace(/\n/g, ' ')
      .trim();

  if (!message) {
    return false;
  }

  const channel =
    `#${TWITCH_USERNAME.toLowerCase()}`;

  twitchChatSocket.send(
    `PRIVMSG ${channel} :${message}\r\n`
  );

  console.log(
    `💬 Twitch → ${message}`
  );

  return true;
}

// ============================================================
// TWITCH CHAT COMMANDS
// ============================================================

function handleTwitchChatMessage(
  line
) {
  const match =
    line.match(
      /^:([^!]+)!.* PRIVMSG #[^ ]+ :(.+)$/i
    );

  if (!match) {
    return;
  }

  const username =
    match[1];

  const content =
    match[2].trim();

  console.log(
    `📩 Twitch : ${username} → ${content}`
  );

  if (
    !content.startsWith('!')
  ) {
    return;
  }

  const parts =
    content
      .slice(1)
      .trim()
      .split(/\s+/);

  const command =
    String(
      parts.shift() || ''
    ).toLowerCase();

  if (
    command === 'discord' ||
    command === 'serveur'
  ) {
    if (!DISCORD_INVITE) {
      sendTwitchChatMessage(
        '❌ Le lien Discord n’est pas configuré.'
      );

      return;
    }

    sendTwitchChatMessage(
      `💫 Rejoins notre serveur Discord : ${DISCORD_INVITE}`
    );
  }

  if (
    command === 'ping'
  ) {
    sendTwitchChatMessage(
      '🟢 Nexus est opérationnel.'
    );
  }
}

// ============================================================
// TWITCH CHAT CONNECT
// ============================================================

async function connectTwitchChat() {
  if (shuttingDown) {
    return null;
  }

  if (
    twitchChatSocket &&
    (
      twitchChatSocket.readyState ===
        WebSocket.OPEN ||

      twitchChatSocket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return twitchChatSocket;
  }

  if (!twitchChatAccessToken) {
    console.warn(
      '⚠️ TWITCH_CHAT_ACCESS_TOKEN absent.'
    );

    console.warn(
      '👉 Ouvre /twitch/chat/login pour autoriser le chat.'
    );

    return null;
  }

  clearTwitchChatReconnectTimer();

  twitchChatAuthenticated =
    false;

  console.log(
    '💬 Connexion Twitch Chat...'
  );

  const ws =
    new WebSocket(
      'wss://irc-ws.chat.twitch.tv:443'
    );

  twitchChatSocket =
    ws;

  ws.on(
    'open',
    () => {
      console.log(
        '🟢 WebSocket Twitch Chat ouvert.'
      );

      const oauthToken =
        twitchChatAccessToken.startsWith(
          'oauth:'
        )
          ? twitchChatAccessToken
          : `oauth:${twitchChatAccessToken}`;

      ws.send(
        `PASS ${oauthToken}\r\n`
      );

      ws.send(
        `NICK ${TWITCH_USERNAME.toLowerCase()}\r\n`
      );

      ws.send(
        `JOIN #${TWITCH_USERNAME.toLowerCase()}\r\n`
      );
    }
  );

  ws.on(
    'message',
    rawMessage => {
      try {
        const data =
          rawMessage.toString();

        const lines =
          data.split('\r\n');

        for (
          const line
          of lines
        ) {
          if (!line) {
            continue;
          }

          // --------------------------------------------------
          // PING
          // --------------------------------------------------

          if (
            line.startsWith(
              'PING'
            )
          ) {
            ws.send(
              'PONG :tmi.twitch.tv\r\n'
            );

            continue;
          }

          // --------------------------------------------------
          // LOGIN SUCCESS
          // --------------------------------------------------

          if (
            line.includes(
              ' 001 '
            )
          ) {
            twitchChatAuthenticated =
              true;

            twitchChatReconnectAttempt =
              0;

            console.log(
              '✅ Nexus connecté au chat Twitch.'
            );

            continue;
          }

          // --------------------------------------------------
          // NOTICE
          // --------------------------------------------------

          if (
            line.startsWith(
              ':tmi.twitch.tv NOTICE'
            )
          ) {
            console.warn(
              '⚠️ Twitch Chat NOTICE :',
              line
            );

            const lower =
              line.toLowerCase();

            if (
              lower.includes(
                'login authentication failed'
              ) ||
              lower.includes(
                'improperly formatted auth'
              ) ||
              lower.includes(
                'authentication failed'
              ) ||
              lower.includes(
                'invalid oauth'
              )
            ) {
              twitchChatAuthenticated =
                false;

              console.error(
                '❌ Authentification Twitch Chat refusée.'
              );

              console.error(
                '👉 Vérifie le compte Twitch autorisé et les scopes OAuth.'
              );
            }

            continue;
          }

          // --------------------------------------------------
          // PRIVMSG
          // --------------------------------------------------

          if (
            line.includes(
              ' PRIVMSG '
            )
          ) {
            handleTwitchChatMessage(
              line
            );
          }
        }

      } catch (error) {
        console.error(
          '❌ Lecture Twitch Chat :',
          error.message
        );
      }
    }
  );

  ws.on(
    'error',
    error => {
      twitchChatAuthenticated =
        false;

      console.error(
        '🔴 Twitch Chat WebSocket :',
        error.message
      );
    }
  );

  ws.on(
    'close',
    (code, reason) => {
      twitchChatAuthenticated =
        false;

      if (
        twitchChatSocket ===
        ws
      ) {
        twitchChatSocket =
          null;
      }

      console.warn(
        `🟠 Twitch Chat fermé. Code=${code} Reason=${
          reason
            ? reason.toString()
            : 'aucune'
        }`
      );

      if (!shuttingDown) {
        scheduleTwitchChatReconnect();
      }
    }
  );

  return ws;
}

// ============================================================
// OAUTH TWITCH CHAT
// ============================================================

function getTwitchChatLoginUrl() {
  const params =
    new URLSearchParams({
      response_type:
        'code',

      client_id:
        TWITCH_CLIENT_ID,

      redirect_uri:
        TWITCH_CHAT_REDIRECT_URI,

      scope:
        'user:read:chat user:write:chat',

      force_verify:
        'true'
    });

  return (
    'https://id.twitch.tv/oauth2/authorize?' +
    params.toString()
  );
}

// ============================================================
// SANCTIONS PERMISSIONS
// ============================================================

function canModerate(
  interaction
) {
  return Boolean(
    interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.ManageMessages
    )
  );
}

function isAdmin(
  interaction
) {
  return Boolean(
    interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    )
  );
}

// ============================================================
// CRÉATION SANCTION
// ============================================================

async function createSanctionRequest({
  guild,
  targetUser,
  proposedSanction,
  reason,
  source,
  detectedMessage = null
}) {
  try {
    if (
      !guild ||
      !targetUser
    ) {
      return null;
    }

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (!channel) {
      return null;
    }

    const requestId =
      `${Date.now()}_${targetUser.id}`;

    const request = {
      id: requestId,

      guildId:
        guild.id,

      targetUserId:
        targetUser.id,

      targetTag:
        targetUser.tag ||
        targetUser.username,

      proposedSanction,

      finalSanction:
        proposedSanction,

      reason,

      source,

      detectedMessage,

      yesVotes:
        new Set(),

      noVotes:
        new Set(),

      status:
        'pending',

      messageId:
        null,

      createdAt:
        Date.now()
    };

    const sourceText =
      source === 'automatic'
        ? '🤖 Auto-modération'
        : `👮 Modérateur : <@${source}>`;

    const embed =
      new EmbedBuilder()
        .setColor(0xFFA500)

        .setTitle(
          '🚨 Demande de sanction'
        )

        .setDescription(
          `👤 **Membre :** <@${targetUser.id}>\n\n` +
          `⚠️ **Sanction proposée :** ${proposedSanction}\n\n` +
          `📝 **Raison :** ${reason}\n\n` +
          `🔎 **Source :** ${sourceText}`
        )

        .addFields({
          name:
            '🗳️ Votes',

          value:
            '🟢 Pour : **0**\n' +
            '🔴 Contre : **0**\n\n' +
            'Validation automatique à **3 votes Pour**.'
        })

        .setFooter({
          text:
            `Nexus • ID ${requestId}`
        })

        .setTimestamp();

    if (detectedMessage) {
      embed.addFields({
        name:
          '💬 Message concerné',

        value:
          String(
            detectedMessage
          ).slice(
            0,
            1000
          )
      });
    }

    const buttons =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `sanction_yes_${requestId}`
            )
            .setLabel(
              'Pour'
            )
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              `sanction_no_${requestId}`
            )
            .setLabel(
              'Contre'
            )
            .setStyle(
              ButtonStyle.Danger
            ),

          new ButtonBuilder()
            .setCustomId(
              `sanction_modify_${requestId}`
            )
            .setLabel(
              'Modifier la sanction'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
        );

    const sentMessage =
      await channel.send({
        embeds: [embed],
        components: [buttons]
      });

    request.messageId =
      sentMessage.id;

    sanctionRequests.set(
      requestId,
      request
    );

    console.log(
      '🚨 Demande de sanction créée :',
      requestId
    );

    return request;

  } catch (error) {
    console.error(
      '❌ Création sanction :',
      error.message
    );

    return null;
  }
}

// ============================================================
// UPDATE SANCTION
// ============================================================

async function updateSanctionMessage(
  request
) {
  try {
    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    const message =
      await channel.messages.fetch(
        request.messageId
      );

    const embed =
      EmbedBuilder.from(
        message.embeds[0]
      );

    const voteField = {
      name:
        '🗳️ Votes',

      value:
        `🟢 Pour : **${request.yesVotes.size}**\n` +
        `🔴 Contre : **${request.noVotes.size}**\n\n` +
        'Validation automatique à **3 votes Pour**.'
    };

    const fields =
      embed.data.fields || [];

    const index =
      fields.findIndex(
        field =>
          field.name ===
          '🗳️ Votes'
      );

    if (index >= 0) {
      embed.spliceFields(
        index,
        1,
        voteField
      );
    } else {
      embed.addFields(
        voteField
      );
    }

    await message.edit({
      embeds: [embed]
    });

  } catch (error) {
    console.error(
      '❌ Update sanction :',
      error.message
    );
  }
}

// ============================================================
// FINALISATION SANCTION
// ============================================================

async function finalizeSanctionRequest(
  request
) {
  try {
    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    const message =
      await channel.messages.fetch(
        request.messageId
      );

    const approved =
      request.status ===
      'approved';

    const embed =
      EmbedBuilder.from(
        message.embeds[0]
      )

        .setColor(
          approved
            ? 0x00FF00
            : 0xFF0000
        )

        .addFields({
          name:
            '📌 Décision',

          value:
            approved
              ? '🟢 **VALIDÉE**'
              : '🔴 **REFUSÉE**'
        });

    const disabledRow =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              `finished_yes_${request.id}`
            )
            .setLabel(
              'Pour'
            )
            .setStyle(
              ButtonStyle.Success
            )
            .setDisabled(true),

          new ButtonBuilder()
            .setCustomId(
              `finished_no_${request.id}`
            )
            .setLabel(
              'Contre'
            )
            .setStyle(
              ButtonStyle.Danger
            )
            .setDisabled(true),

          new ButtonBuilder()
            .setCustomId(
              `finished_modify_${request.id}`
            )
            .setLabel(
              'Modifier la sanction'
            )
            .setStyle(
              ButtonStyle.Secondary
            )
            .setDisabled(true)
        );

    await message.edit({
      embeds: [embed],
      components: [disabledRow]
    });

    console.log(
      `📌 Sanction ${request.id} : ${
        approved
          ? 'APPROUVÉE'
          : 'REFUSÉE'
      }`
    );

  } catch (error) {
    console.error(
      '❌ Finalisation sanction :',
      error.message
    );
  }
}

// ============================================================
// VOTE SANCTION
// ============================================================

async function handleSanctionVote(
  interaction,
  requestId,
  vote
) {
  if (
    !canModerate(interaction) &&
    !isAdmin(interaction)
  ) {
    await interaction.reply({
      content:
        '❌ Tu n’as pas la permission.',
      ephemeral: true
    });

    return;
  }

  const request =
    sanctionRequests.get(
      requestId
    );

  if (!request) {
    await interaction.reply({
      content:
        '❌ Demande introuvable en mémoire.',
      ephemeral: true
    });

    return;
  }

  if (
    request.status !==
    'pending'
  ) {
    await interaction.reply({
      content:
        '❌ Cette demande est déjà terminée.',
      ephemeral: true
    });

    return;
  }

  const voterId =
    interaction.user.id;

  // ADMIN
  if (
    isAdmin(interaction)
  ) {
    request.status =
      vote === 'yes'
        ? 'approved'
        : 'rejected';

    await interaction.reply({
      content:
        vote === 'yes'
          ? '👑 Demande validée par un administrateur.'
          : '👑 Demande refusée par un administrateur.',
      ephemeral: true
    });

    await finalizeSanctionRequest(
      request
    );

    return;
  }

  if (
    request.yesVotes.has(
      voterId
    ) ||
    request.noVotes.has(
      voterId
    )
  ) {
    await interaction.reply({
      content:
        '❌ Tu as déjà voté.',
      ephemeral: true
    });

    return;
  }

  if (vote === 'yes') {
    request.yesVotes.add(
      voterId
    );
  } else {
    request.noVotes.add(
      voterId
    );
  }

  if (
    request.yesVotes.size >=
    3
  ) {
    request.status =
      'approved';

    await interaction.reply({
      content:
        '🟢 3 votes Pour atteints. Demande validée.',
      ephemeral: true
    });

    await finalizeSanctionRequest(
      request
    );

    return;
  }

  await updateSanctionMessage(
    request
  );

  await interaction.reply({
    content:
      vote === 'yes'
        ? '🟢 Vote Pour enregistré.'
        : '🔴 Vote Contre enregistré.',
    ephemeral: true
  });
}

// ============================================================
// MODIFICATION SANCTION
// ============================================================

async function handleModifySanction(
  interaction,
  requestId
) {
  if (
    !canModerate(interaction) &&
    !isAdmin(interaction)
  ) {
    await interaction.reply({
      content:
        '❌ Tu n’as pas la permission.',
      ephemeral: true
    });

    return;
  }

  const request =
    sanctionRequests.get(
      requestId
    );

  if (!request) {
    await interaction.reply({
      content:
        '❌ Demande introuvable.',
      ephemeral: true
    });

    return;
  }

  await interaction.reply({
    content:
      '🟡 La modification avancée de la sanction sera ajoutée ensuite.',
    ephemeral: true
  });
}

// ============================================================
// INTERACTIONS DISCORD
// ============================================================

client.on(
  'interactionCreate',
  async interaction => {
    try {
      // ======================================================
      // SLASH COMMAND
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {
        if (
          interaction.commandName !==
          'sanction'
        ) {
          return;
        }

        if (
          !canModerate(interaction) &&
          !isAdmin(interaction)
        ) {
          await interaction.reply({
            content:
              '❌ Cette commande est réservée à la modération.',
            ephemeral: true
          });

          return;
        }

        const target =
          interaction.options.getUser(
            'membre'
          );

        const sanction =
          interaction.options.getString(
            'sanction'
          );

        const reason =
          interaction.options.getString(
            'raison'
          );

        if (!target) {
          await interaction.reply({
            content:
              '❌ Membre introuvable.',
            ephemeral: true
          });

          return;
        }

        if (
          target.id ===
          interaction.user.id
        ) {
          await interaction.reply({
            content:
              '❌ Tu ne peux pas créer une sanction contre toi-même.',
            ephemeral: true
          });

          return;
        }

        const guild =
          interaction.guild;

        if (!guild) {
          await interaction.reply({
            content:
              '❌ Utilise cette commande sur un serveur.',
            ephemeral: true
          });

          return;
        }

        const member =
          await guild.members.fetch(
            target.id
          );

        if (
          member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {
          await interaction.reply({
            content:
              '❌ Impossible de créer une demande contre un administrateur.',
            ephemeral: true
          });

          return;
        }

        const request =
          await createSanctionRequest({
            guild,

            targetUser:
              target,

            proposedSanction:
              sanction,

            reason,

            source:
              interaction.user.id
          });

        if (!request) {
          await interaction.reply({
            content:
              '❌ Impossible de créer la demande.',
            ephemeral: true
          });

          return;
        }

        await interaction.reply({
          content:
            '✅ Demande créée dans le salon staff.',
          ephemeral: true
        });

        return;
      }

      // ======================================================
      // BOUTONS
      // ======================================================

      if (
        interaction.isButton()
      ) {
        const parts =
          interaction.customId.split(
            '_'
          );

        if (
          parts.length < 3
        ) {
          return;
        }

        const action =
          parts[1];

        const requestId =
          parts
            .slice(2)
            .join('_');

        if (
          action ===
          'yes'
        ) {
          await handleSanctionVote(
            interaction,
            requestId,
            'yes'
          );

          return;
        }

        if (
          action ===
          'no'
        ) {
          await handleSanctionVote(
            interaction,
            requestId,
            'no'
          );

          return;
        }

        if (
          action ===
          'modify'
        ) {
          await handleModifySanction(
            interaction,
            requestId
          );
        }
      }

    } catch (error) {
      console.error(
        '❌ Interaction :',
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        try {
          await interaction.reply({
            content:
              '❌ Une erreur est survenue.',
            ephemeral: true
          });
        } catch {}
      }
    }
  }
);

// ============================================================
// AUTO MOD DISCORD
// ============================================================

client.on(
  'messageCreate',
  async message => {
    try {
      if (shuttingDown) {
        return;
      }

      if (message.author.bot) {
        return;
      }

      if (!message.guild) {
        return;
      }

      if (
        !message.content ||
        !message.content.trim()
      ) {
        return;
      }

      const detected =
        detectModeration(
          message.content
        );

      if (
        !detected.general &&
        !detected.sensitive
      ) {
        return;
      }

      const type =
        detected.sensitive
          ? 'sensitive'
          : 'general';

      const data =
        registerDetection(
          message.author.id,
          type
        );

      const generalCount =
        data.general.length;

      const sensitiveCount =
        data.sensitive.length;

      console.log(
        `[AUTO-MOD] ${message.author.tag} | ` +
        `générales=${generalCount} | ` +
        `sensibles=${sensitiveCount}`
      );

      // ======================================================
      // CONTENU SENSIBLE
      // ======================================================

      if (
        detected.sensitive
      ) {
        await createSanctionRequest({
          guild:
            message.guild,

          targetUser:
            message.author,

          proposedSanction:
            'À déterminer',

          reason:
            'Détection automatique d’un contenu potentiellement discriminatoire. Contexte à examiner.',

          source:
            'automatic',

          detectedMessage:
            message.content
        });

        return;
      }

      // ======================================================
      // INSULTES
      // ======================================================

      if (
        generalCount >=
        GENERAL_INSULT_THRESHOLD
      ) {
        const now =
          Date.now();

        const lastRequest =
          sanctionCooldowns.get(
            message.author.id
          );

        if (
          lastRequest &&
          now - lastRequest <
            SANCTION_COOLDOWN
        ) {
          return;
        }

        sanctionCooldowns.set(
          message.author.id,
          now
        );

        await createSanctionRequest({
          guild:
            message.guild,

          targetUser:
            message.author,

          proposedSanction:
            'À déterminer',

          reason:
            `${generalCount} messages contenant des insultes détectés en moins d'une minute.`,

          source:
            'automatic',

          detectedMessage:
            message.content
        });
      }

    } catch (error) {
      console.error(
        '❌ Auto-mod :',
        error.message
      );
    }
  }
);

// ============================================================
// COMMANDE /SANCTION
// ============================================================

const sanctionCommand =
  new SlashCommandBuilder()
    .setName(
      'sanction'
    )

    .setDescription(
      'Créer une demande de sanction pour un membre.'
    )

    .addUserOption(
      option =>
        option
          .setName(
            'membre'
          )
          .setDescription(
            'Membre concerné.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName(
            'sanction'
          )
          .setDescription(
            'Sanction proposée.'
          )
          .setRequired(true)

          .addChoices(
            {
              name:
                'Avertissement',

              value:
                'Avertissement'
            },

            {
              name:
                'Timeout',

              value:
                'Timeout'
            },

            {
              name:
                'Kick',

              value:
                'Kick'
            },

            {
              name:
                'Ban',

              value:
                'Ban'
            }
          )
    )

    .addStringOption(
      option =>
        option
          .setName(
            'raison'
          )

          .setDescription(
            'Raison de la demande.'
          )

          .setRequired(true)
    );

// ============================================================
// REGISTER COMMAND
// ============================================================

async function registerCommands() {
  if (
    !DISCORD_TOKEN ||
    !DISCORD_CLIENT_ID
  ) {
    return false;
  }

  try {
    const rest =
      new REST({
        version:
          '10'
      }).setToken(
        DISCORD_TOKEN
      );

    await rest.put(
      Routes.applicationCommands(
        DISCORD_CLIENT_ID
      ),
      {
        body: [
          sanctionCommand.toJSON()
        ]
      }
    );

    console.log(
      '✅ /sanction enregistrée.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Enregistrement commandes :',
      error.message
    );

    return false;
  }
}

// ============================================================
// DISCORD READY
// ============================================================

client.once(
  'clientReady',
  async () => {
    discordReadyAt =
      Date.now();

    console.log(
      `🟢 Nexus connecté : ${client.user.tag}`
    );

    console.log(
      '🟢 Discord Gateway : READY'
    );

    console.log(
      '📡 Discord ping :',
      client.ws.ping,
      'ms'
    );

    await registerCommands();
  }
);

// ============================================================
// DISCORD EVENTS
// ============================================================

client.on(
  'error',
  error => {
    console.error(
      '🔴 ERREUR DISCORD :',
      error
    );
  }
);

client.on(
  'warn',
  message => {
    console.warn(
      '[DISCORD WARN]',
      message
    );
  }
);

client.on(
  'debug',
  message => {
    console.log(
      '[DISCORD DEBUG]',
      message
    );
  }
);

client.on(
  'shardReady',
  id => {
    discordReadyAt =
      Date.now();

    console.log(
      '🟢 Shard prêt :',
      id
    );
  }
);

client.on(
  'shardDisconnect',
  (event, id) => {
    console.error(
      '🔴 DISCORD SHARD DÉCONNECTÉ'
    );

    console.error(
      'Shard :',
      id
    );

    console.error(
      'Code :',
      event?.code ||
      'inconnu'
    );
  }
);

client.on(
  'shardReconnecting',
  id => {
    console.warn(
      '🟠 Discord reconnexion automatique.'
    );

    console.warn(
      'Shard :',
      id
    );
  }
);

client.on(
  'shardResume',
  (id, replayedEvents) => {
    discordReadyAt =
      Date.now();

    console.log(
      '🟢 Discord Gateway reconnecté.'
    );

    console.log(
      'Shard :',
      id
    );

    console.log(
      'Événements rejoués :',
      replayedEvents
    );
  }
);

// ============================================================
// WATCHDOG
// ============================================================

setInterval(
  () => {
    if (shuttingDown) {
      return;
    }

    try {
      const discordStatus =
        client.ws.status;

      const statusName =
        getDiscordStatusName(
          discordStatus
        );

      console.log(
        `[WATCHDOG] ` +
        `Discord=${statusName} | ` +
        `ping=${client.ws.ping}ms | ` +
        `uptime=${Math.floor(
          process.uptime()
        )}s | ` +
        `EventSub=${
          twitchEventSubSocket &&
          twitchEventSubSocket.readyState ===
            WebSocket.OPEN
            ? 'connected'
            : 'disconnected'
        } | ` +
        `TwitchChat=${
          twitchChatSocket &&
          twitchChatSocket.readyState ===
            WebSocket.OPEN &&
          twitchChatAuthenticated
            ? 'connected'
            : 'disconnected'
        }`
      );

    } catch (error) {
      console.error(
        '❌ Watchdog :',
        error.message
      );
    }
  },
  30000
);

// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {
      try {
        const url =
          new URL(
            req.url,
            'https://nexus-bpsk.onrender.com'
          );

        // ======================================================
        // /
        // ======================================================

        if (
          url.pathname === '/'
        ) {
          const online =
            client.ws.status ===
            Status.Ready;

          res.writeHead(
            online
              ? 200
              : 503,
            {
              'Content-Type':
                'text/plain; charset=utf-8'
            }
          );

          res.end(
            online
              ? 'Nexus is online'
              : 'Nexus Discord connection unavailable'
          );

          return;
        }

        // ======================================================
        // /health
        // ======================================================

        if (
          url.pathname ===
          '/health'
        ) {
          const discordStatus =
            client.ws.status;

          const discordReady =
            discordStatus ===
            Status.Ready;

          const eventSubConnected =
            Boolean(
              twitchEventSubSocket &&
              twitchEventSubSocket.readyState ===
                WebSocket.OPEN
            );

          const chatConnected =
            Boolean(
              twitchChatSocket &&
              twitchChatSocket.readyState ===
                WebSocket.OPEN &&
              twitchChatAuthenticated
            );

          res.writeHead(
            discordReady
              ? 200
              : 503,
            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          );

          res.end(
            JSON.stringify({
              status:
                discordReady
                  ? 'online'
                  : 'degraded',

              discord:
                getDiscordStatusName(
                  discordStatus
                ),

              discordReady,

              ping:
                client.ws.ping,

              user:
                client.user
                  ? client.user.tag
                  : null,

              uptime:
                process.uptime(),

              twitch: {
                username:
                  TWITCH_USERNAME,

                userId:
                  twitchUserId,

                eventSubConnected:
                  eventSubConnected,

                chatConnected:
                  chatConnected,

                chatTokenConfigured:
                  Boolean(
                    twitchChatAccessToken
                  )
              },

              shuttingDown,

              timestamp:
                new Date().toISOString()
            })
          );

          return;
        }

        // ======================================================
        // TWITCH CHAT LOGIN
        // ======================================================

        if (
          url.pathname ===
          '/twitch/chat/login'
        ) {
          if (
            !TWITCH_CLIENT_ID
          ) {
            res.writeHead(
              500,
              {
                'Content-Type':
                  'text/plain; charset=utf-8'
              }
            );

            res.end(
              'TWITCH_CLIENT_ID absent.'
            );

            return;
          }

          const loginUrl =
            getTwitchChatLoginUrl();

          res.writeHead(
            302,
            {
              Location:
                loginUrl
            }
          );

          res.end();

          return;
        }

        // ======================================================
        // TWITCH CHAT CALLBACK
        // ======================================================

        if (
          url.pathname ===
          '/twitch/chat/callback'
        ) {
          const code =
            url.searchParams.get(
              'code'
            );

          const error =
            url.searchParams.get(
              'error'
            );

          if (error) {
            res.writeHead(
              400,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              `
              <h1>❌ Autorisation Twitch refusée</h1>
              <p>${escapeHtml(error)}</p>
              `
            );

            return;
          }

          if (!code) {
            res.writeHead(
              400,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              '<h1>❌ Code Twitch manquant.</h1>'
            );

            return;
          }

          try {
            const response =
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

                      code,

                      grant_type:
                        'authorization_code',

                      redirect_uri:
                        TWITCH_CHAT_REDIRECT_URI
                    })
                }
              );

            const data =
              await response.json();

            if (!response.ok) {
              console.error(
                '❌ OAuth Twitch Chat :',
                data
              );

              res.writeHead(
                500,
                {
                  'Content-Type':
                    'text/html; charset=utf-8'
                }
              );

              res.end(
                `
                <h1>❌ Erreur OAuth Twitch</h1>
                <p>Regarde les logs Render.</p>
                `
              );

              return;
            }

            if (
              !data.access_token
            ) {
              throw new Error(
                'Aucun access token reçu.'
              );
            }

            twitchChatAccessToken =
              data.access_token;

            twitchChatRefreshToken =
              data.refresh_token ||
              '';

            process.env.TWITCH_CHAT_ACCESS_TOKEN =
              twitchChatAccessToken;

            process.env.TWITCH_CHAT_REFRESH_TOKEN =
              twitchChatRefreshToken;

            console.log(
              '============================================'
            );

            console.log(
              '✅ TWITCH CHAT OAUTH RÉUSSI'
            );

            console.log(
              'Scopes :',
              data.scope
            );

            console.log(
              'Access Token Chat présent :',
              Boolean(
                twitchChatAccessToken
              )
            );

            console.log(
              'Refresh Token Chat présent :',
              Boolean(
                twitchChatRefreshToken
              )
            );

            console.log(
              '============================================'
            );

            // Fermer ancienne connexion
            if (
              twitchChatSocket
            ) {
              try {
                twitchChatSocket.close();
              } catch {}
            }

            twitchChatSocket =
              null;

            twitchChatAuthenticated =
              false;

            await sleep(500);

            await connectTwitchChat();

            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              `
              <!doctype html>

              <html lang="fr">

              <head>
                <meta charset="utf-8">
                <title>Nexus Twitch</title>
              </head>

              <body>

                <h1>
                  ✅ Twitch Chat connecté !
                </h1>

                <p>
                  Nexus a bien obtenu
                  l'autorisation Twitch.
                </p>

                <p>
                  Tu peux fermer cette page.
                </p>

              </body>

              </html>
              `
            );

          } catch (error) {
            console.error(
              '❌ OAuth Chat :',
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
              `
              <h1>❌ Erreur OAuth Twitch</h1>
              <p>Regarde les logs Render.</p>
              `
            );
          }

          return;
        }

        // ======================================================
        // ANCIEN CALLBACK TWITCH
        // ======================================================

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

          if (error) {
            res.writeHead(
              400,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              '<h1>❌ Autorisation Twitch refusée.</h1>'
            );

            return;
          }

          if (!code) {
            res.writeHead(
              400,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              '<h1>❌ Code Twitch manquant.</h1>'
            );

            return;
          }

          try {
            const response =
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

                      code,

                      grant_type:
                        'authorization_code',

                      redirect_uri:
                        TWITCH_REDIRECT_URI
                    })
                }
              );

            const data =
              await response.json();

            if (!response.ok) {
              console.error(
                '❌ OAuth Twitch API :',
                data
              );

              res.writeHead(
                500
              );

              res.end(
                'Erreur OAuth Twitch.'
              );

              return;
            }

            if (
              data.access_token
            ) {
              twitchAccessToken =
                data.access_token;

              process.env.TWITCH_ACCESS_TOKEN =
                twitchAccessToken;
            }

            if (
              data.refresh_token
            ) {
              twitchRefreshToken =
                data.refresh_token;

              process.env.TWITCH_REFRESH_TOKEN =
                twitchRefreshToken;

              console.warn(
                '⚠️ Nouveau TWITCH_REFRESH_TOKEN reçu.'
              );

              console.warn(
                '⚠️ Mets-le à jour dans Render.'
              );
            }

            console.log(
              '✅ OAuth Twitch API terminé.'
            );

            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              `
              <h1>✅ Twitch connecté !</h1>
              <p>Tu peux fermer cette page.</p>
              `
            );

          } catch (error) {
            console.error(
              '❌ OAuth Twitch :',
              error.message
            );

            res.writeHead(
              500
            );

            res.end(
              'Erreur OAuth Twitch.'
            );
          }

          return;
        }

        // ======================================================
        // 404
        // ======================================================

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

      } catch (error) {
        console.error(
          '❌ Erreur HTTP :',
          error.message
        );

        if (!res.headersSent) {
          res.writeHead(
            500,
            {
              'Content-Type':
                'text/plain; charset=utf-8'
            }
          );
        }

        res.end(
          'Internal Server Error'
        );
      }
    }
  );

// ============================================================
// HTTP START
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `🌐 Serveur HTTP actif sur le port ${PORT}`
    );
  }
);

// ============================================================
// INITIALISATION TWITCH
// ============================================================

async function initializeTwitch() {
  console.log(
    '📡 Initialisation Twitch...'
  );

  // ----------------------------------------------------------
  // API TOKEN
  // ----------------------------------------------------------

  if (
    twitchAccessToken
  ) {
    const validation =
      await validateTwitchToken(
        twitchAccessToken
      );

    if (!validation) {
      console.warn(
        '⚠️ TWITCH_ACCESS_TOKEN invalide ou expiré.'
      );

      if (
        twitchRefreshToken
      ) {
        await refreshTwitchApiToken();
      }
    }
  } else {
    if (
      twitchRefreshToken
    ) {
      await refreshTwitchApiToken();
    } else {
      console.warn(
        '⚠️ Aucun token Twitch API.'
      );
    }
  }

  // ----------------------------------------------------------
  // USER
  // ----------------------------------------------------------

  if (!twitchAccessToken) {
    console.error(
      '❌ Impossible d’initialiser Twitch EventSub.'
    );
  } else {
    const userId =
      await getTwitchUserId(
        TWITCH_USERNAME
      );

    if (userId) {
      twitchUserId =
        userId;

      twitchUser =
        await getTwitchUser(
          userId
        );

      console.log(
        `🎮 Twitch : ${TWITCH_USERNAME}`
      );

      console.log(
        `🆔 Twitch ID : ${userId}`
      );

      await connectTwitchEventSub(
        userId
      );
    }
  }

  // ----------------------------------------------------------
  // CHAT
  // ----------------------------------------------------------

  if (
    !twitchChatAccessToken &&
    twitchChatRefreshToken
  ) {
    await refreshTwitchChatToken();
  }

  if (
    twitchChatAccessToken
  ) {
    await connectTwitchChat();
  } else {
    console.warn(
      '⚠️ Twitch Chat non configuré.'
    );

    console.warn(
      `👉 Autorise Twitch ici : https://nexus-bpsk.onrender.com/twitch/chat/login`
    );
  }
}

// ============================================================
// DISCORD LOGIN
// ============================================================

async function initializeDiscord() {
  if (!DISCORD_TOKEN) {
    console.error(
      '❌ DISCORD_TOKEN absent.'
    );

    return false;
  }

  console.log(
    '🔐 Connexion à Discord...'
  );

  try {
    await client.login(
      DISCORD_TOKEN
    );

    console.log(
      '✅ Login Discord envoyé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Login Discord :',
      error.message
    );

    return false;
  }
}

// ============================================================
// DIAGNOSTIC
// ============================================================

console.log(
  '============================================'
);

console.log(
  '🚀 DÉMARRAGE NEXUS'
);

console.log(
  '============================================'
);

console.log(
  'Discord Token présent :',
  Boolean(
    DISCORD_TOKEN
  )
);

console.log(
  'Discord Client ID présent :',
  Boolean(
    DISCORD_CLIENT_ID
  )
);

console.log(
  'Twitch Client ID présent :',
  Boolean(
    TWITCH_CLIENT_ID
  )
);

console.log(
  'Twitch Client Secret présent :',
  Boolean(
    TWITCH_CLIENT_SECRET
  )
);

console.log(
  'Twitch API Access Token présent :',
  Boolean(
    twitchAccessToken
  )
);

console.log(
  'Twitch API Refresh Token présent :',
  Boolean(
    twitchRefreshToken
  )
);

console.log(
  'Twitch Chat Access Token présent :',
  Boolean(
    twitchChatAccessToken
  )
);

console.log(
  'Twitch Chat Refresh Token présent :',
  Boolean(
    twitchChatRefreshToken
  )
);

console.log(
  'Twitch Chat Username :',
  TWITCH_USERNAME
);

console.log(
  'Discord Invite présent :',
  Boolean(
    DISCORD_INVITE
  )
);

console.log(
  '============================================'
);

// ============================================================
// INITIALISATION
// ============================================================

(async () => {
  await initializeDiscord();

  await initializeTwitch();
})();

// ============================================================
// HEARTBEAT
// ============================================================

setInterval(
  () => {
    if (shuttingDown) {
      return;
    }

    console.log(
      `[PROCESS] Nexus actif depuis ${Math.floor(
        process.uptime()
      )} secondes.`
    );
  },
  30000
);

// ============================================================
// NETTOYAGE MÉMOIRE
// ============================================================

setInterval(
  () => {
    const now =
      Date.now();

    // --------------------------------------------------------
    // Détections
    // --------------------------------------------------------

    for (
      const [
        userId,
        data
      ]
      of detectionTracker.entries()
    ) {
      data.general =
        data.general.filter(
          timestamp =>
            now - timestamp <
            DETECTION_WINDOW
        );

      data.sensitive =
        data.sensitive.filter(
          timestamp =>
            now - timestamp <
            DETECTION_WINDOW
        );

      if (
        data.general.length === 0 &&
        data.sensitive.length === 0
      ) {
        detectionTracker.delete(
          userId
        );
      }
    }

    // --------------------------------------------------------
    // Cooldowns
    // --------------------------------------------------------

    for (
      const [
        userId,
        timestamp
      ]
      of sanctionCooldowns.entries()
    ) {
      if (
        now - timestamp >
        SANCTION_COOLDOWN
      ) {
        sanctionCooldowns.delete(
          userId
        );
      }
    }

    // --------------------------------------------------------
    // Sanctions
    // --------------------------------------------------------

    if (
      sanctionRequests.size >
      500
    ) {
      const requests =
        Array.from(
          sanctionRequests.entries()
        );

      requests
        .slice(0, 100)
        .forEach(
          ([id]) =>
            sanctionRequests.delete(
              id
            )
        );
    }

  },
  5 * 60 * 1000
);

// ============================================================
// PROCESS ERRORS
// ============================================================

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '🔴 UNHANDLED REJECTION :',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '🔴 UNCAUGHT EXCEPTION :',
      error
    );
  }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function gracefulShutdown(
  signal
) {
  if (
    shutdownStarted
  ) {
    return;
  }

  shutdownStarted =
    true;

  shuttingDown =
    true;

  console.warn(
    `🟠 ${signal} reçu. Arrêt propre de Nexus.`
  );

  // ----------------------------------------------------------
  // EventSub
  // ----------------------------------------------------------

  clearTwitchReconnectTimer();

  if (
    twitchEventSubSocket
  ) {
    try {
      twitchEventSubSocket.close(
        1000,
        'Nexus shutdown'
      );
    } catch {}
  }

  twitchEventSubSocket =
    null;

  // ----------------------------------------------------------
  // Chat
  // ----------------------------------------------------------

  clearTwitchChatReconnectTimer();

  if (
    twitchChatSocket
  ) {
    try {
      twitchChatSocket.close(
        1000,
        'Nexus shutdown'
      );
    } catch {}
  }

  twitchChatSocket =
    null;

  twitchChatAuthenticated =
    false;

  // ----------------------------------------------------------
  // Discord
  // ----------------------------------------------------------

  try {
    client.destroy();
  } catch {}

  // ----------------------------------------------------------
  // HTTP
  // ----------------------------------------------------------

  try {
    await new Promise(
      resolve => {
        let finished = false;

        const finish =
          () => {
            if (finished) {
              return;
            }

            finished = true;

            resolve();
          };

        try {
          server.close(
            finish
          );
        } catch {
          finish();
        }

        setTimeout(
          finish,
          5000
        );
      }
    );
  } catch {}

  console.log(
    '🛑 Nexus arrêté proprement.'
  );

  process.exit(0);
}

// ============================================================
// SIGNALS
// ============================================================

process.on(
  'SIGTERM',
  () => {
    gracefulShutdown(
      'SIGTERM'
    );
  }
);

process.on(
  'SIGINT',
  () => {
    gracefulShutdown(
      'SIGINT'
    );
  }
);

// ============================================================
// FIN
// ============================================================

console.log(
  '🚀 Nexus initialisé.'
);
