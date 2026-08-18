```js
'use strict';

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
  Status,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 3000);

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN || '';

const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || '';

const DISCORD_GUILD_ID =
  process.env.DISCORD_GUILD_ID || '';

const TWITCH_CLIENT_ID =
  process.env.TWITCH_CLIENT_ID || '';

const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_CLIENT_SECRET || '';

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

// Timeout par défaut : 10 minutes.
const DEFAULT_TIMEOUT_MS =
  Number(process.env.DEFAULT_TIMEOUT_MS || 10 * 60 * 1000);

// Auto-mod.
const GENERAL_INSULT_THRESHOLD =
  Number(process.env.GENERAL_INSULT_THRESHOLD || 3);

const DETECTION_WINDOW =
  Number(process.env.DETECTION_WINDOW_MS || 60 * 1000);

const SANCTION_COOLDOWN =
  Number(process.env.SANCTION_COOLDOWN_MS || 5 * 60 * 1000);

// ============================================================
// TOKENS TWITCH
// ============================================================
//
// API / EventSub stream
//
// TWITCH_ACCESS_TOKEN
// TWITCH_REFRESH_TOKEN
//
// Chat / EventSub chat
//
// TWITCH_CHAT_ACCESS_TOKEN
// TWITCH_CHAT_REFRESH_TOKEN
//
// Important : les tokens OAuth ne doivent JAMAIS être loggés.
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
// MODERATION
// ============================================================

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
// ETAT
// ============================================================

let shuttingDown = false;
let shutdownStarted = false;

let discordReadyAt = null;

let twitchUserId = null;
let twitchUser = null;

let twitchChatUserId = null;
let twitchChatUser = null;

let lastAnnouncedStreamId = null;

// ============================================================
// EVENTSUB STREAM
// ============================================================

let twitchStreamSocket = null;
let twitchStreamSessionId = null;
let twitchStreamReconnectTimer = null;
let twitchStreamReconnectAttempt = 0;

// ============================================================
// EVENTSUB CHAT
// ============================================================

let twitchChatSocket = null;
let twitchChatSessionId = null;
let twitchChatReconnectTimer = null;
let twitchChatReconnectAttempt = 0;

// ============================================================
// DEDUPLICATION EVENTSUB
// ============================================================

const processedTwitchMessageIds =
  new Map();

// ============================================================
// MODERATION MEMORY
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
// UTILITAIRES
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

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.,!?;:/\\()[\]{}"'`]+/g, ' ')
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

function getDiscordStatusName(status) {
  const entry =
    Object.entries(Status).find(
      ([, value]) => value === status
    );

  return entry
    ? entry[0]
    : `UNKNOWN(${status})`;
}

function safeText(value, max = 1000) {
  const text =
    String(value || '')
      .replace(/\r/g, '')
      .replace(/\n/g, ' ')
      .trim();

  return text.slice(0, max);
}

// ============================================================
// TWITCH API
// ============================================================

function twitchHeaders(token) {
  return {
    'Client-ID':
      TWITCH_CLIENT_ID,

    'Authorization':
      `Bearer ${token}`
  };
}

async function validateTwitchToken(token) {
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
      '❌ Validation Twitch:',
      error.message
    );

    return null;
  }
}

// ============================================================
// REFRESH API TOKEN
// ============================================================

async function refreshTwitchApiToken() {
  if (
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET ||
    !twitchRefreshToken
  ) {
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
        '❌ Refresh Twitch API:',
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
        '⚠️ Le refresh token Twitch API a été renouvelé.'
      );

      console.warn(
        '⚠️ Pense à mettre le nouveau token dans Render.'
      );
    }

    console.log(
      '✅ Token Twitch API renouvelé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Refresh Twitch API:',
      error.message
    );

    return false;
  }
}

// ============================================================
// REFRESH CHAT TOKEN
// ============================================================

async function refreshTwitchChatToken() {
  if (
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET ||
    !twitchChatRefreshToken
  ) {
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
        '❌ Refresh Twitch Chat:',
        data
      );

      return false;
    }

    if (!data.access_token) {
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
        '⚠️ Le refresh token Twitch Chat a été renouvelé.'
      );

      console.warn(
        '⚠️ Pense à mettre le nouveau token dans Render.'
      );
    }

    console.log(
      '✅ Token Twitch Chat renouvelé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Refresh Twitch Chat:',
      error.message
    );

    return false;
  }
}

// ============================================================
// TWITCH USER
// ============================================================

async function getTwitchUserByLogin(
  username,
  token = twitchAccessToken
) {
  if (!token) {
    return null;
  }

  try {
    const response =
      await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
        {
          headers:
            twitchHeaders(token)
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Twitch users:',
        data
      );

      return null;
    }

    return data.data?.[0] || null;

  } catch (error) {
    console.error(
      '❌ Twitch user:',
      error.message
    );

    return null;
  }
}

async function getTwitchUserById(
  userId,
  token = twitchAccessToken
) {
  if (!token || !userId) {
    return null;
  }

  try {
    const response =
      await fetch(
        `https://api.twitch.tv/helix/users?id=${encodeURIComponent(userId)}`,
        {
          headers:
            twitchHeaders(token)
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return null;
    }

    return data.data?.[0] || null;

  } catch (error) {
    console.error(
      '❌ Twitch user ID:',
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
            twitchHeaders(
              twitchAccessToken
            )
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return null;
    }

    return data.data?.[0] || null;

  } catch (error) {
    console.error(
      '❌ Twitch stream:',
      error.message
    );

    return null;
  }
}

// ============================================================
// AUTO MODERATION
// ============================================================

function detectModeration(content) {
  let general = false;
  let sensitive = false;

  for (
    const word of GENERAL_INSULTS
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
    const word of SENSITIVE_PATTERNS
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

function registerDetection(
  userId,
  type
) {
  const now =
    Date.now();

  const data =
    detectionTracker.get(
      userId
    ) || {
      general: [],
      sensitive: []
    };

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
// TWITCH SEND CHAT
// ============================================================
//
// On n'utilise plus PRIVMSG IRC.
// On utilise l'API Twitch officielle.
// ============================================================

async function sendTwitchChatMessage(
  text
) {
  if (
    !twitchChatAccessToken ||
    !twitchChatUserId ||
    !twitchUserId
  ) {
    console.warn(
      '⚠️ Twitch Chat non configuré.'
    );

    return false;
  }

  const message =
    safeText(
      text,
      500
    );

  if (!message) {
    return false;
  }

  try {
    const response =
      await fetch(
        'https://api.twitch.tv/helix/chat/messages',
        {
          method: 'POST',

          headers: {
            ...twitchHeaders(
              twitchChatAccessToken
            ),

            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              broadcaster_id:
                twitchUserId,

              sender_id:
                twitchChatUserId,

              message
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ Envoi Twitch Chat:',
        data
      );

      return false;
    }

    if (
      data.data?.[0]?.is_sent === false
    ) {
      console.warn(
        '⚠️ Twitch n’a pas envoyé le message:',
        data.data?.[0]?.drop_reason
      );

      return false;
    }

    console.log(
      `💬 Twitch → ${message}`
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Send Twitch Chat:',
      error.message
    );

    return false;
  }
}

// ============================================================
// TWITCH CHAT COMMANDS
// ============================================================

async function handleTwitchChatMessage(
  event
) {
  const username =
    event.chatter_user_name ||
    event.chatter_user_login ||
    'inconnu';

  const content =
    String(
      event.message?.text || ''
    ).trim();

  if (!content) {
    return;
  }

  console.log(
    `📩 Twitch : ${username} → ${content}`
  );

  if (!content.startsWith('!')) {
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

  switch (command) {
    case 'discord':
    case 'serveur': {
      if (!DISCORD_INVITE) {
        await sendTwitchChatMessage(
          '❌ Le lien Discord n’est pas configuré.'
        );

        return;
      }

      await sendTwitchChatMessage(
        `💫 Rejoins notre serveur Discord : ${DISCORD_INVITE}`
      );

      break;
    }

    case 'ping': {
      await sendTwitchChatMessage(
        '🟢 Nexus est opérationnel.'
      );

      break;
    }

    case 'live': {
      await sendTwitchChatMessage(
        `🔴 ${TWITCH_USERNAME} est actuellement en live !`
      );

      break;
    }

    default:
      break;
  }
}

// ============================================================
// EVENTSUB HELPERS
// ============================================================

function clearTimer(
  timerName
) {
  if (timerName) {
    clearTimeout(timerName);
  }
}

function scheduleStreamReconnect() {
  if (
    shuttingDown ||
    twitchStreamReconnectTimer
  ) {
    return;
  }

  twitchStreamReconnectAttempt++;

  const delay =
    Math.min(
      5000 *
        Math.pow(
          2,
          twitchStreamReconnectAttempt - 1
        ),
      60000
    );

  console.warn(
    `⏳ Reconnexion EventSub Stream dans ${Math.round(
      delay / 1000
    )}s.`
  );

  twitchStreamReconnectTimer =
    setTimeout(
      async () => {
        twitchStreamReconnectTimer =
          null;

        if (
          shuttingDown ||
          !twitchAccessToken ||
          !twitchUserId
        ) {
          return;
        }

        await connectTwitchStreamEventSub();
      },
      delay
    );
}

function scheduleChatReconnect() {
  if (
    shuttingDown ||
    twitchChatReconnectTimer
  ) {
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
    `⏳ Reconnexion EventSub Chat dans ${Math.round(
      delay / 1000
    )}s.`
  );

  twitchChatReconnectTimer =
    setTimeout(
      async () => {
        twitchChatReconnectTimer =
          null;

        if (
          shuttingDown ||
          !twitchChatAccessToken ||
          !twitchUserId ||
          !twitchChatUserId
        ) {
          return;
        }

        await connectTwitchChatEventSub();
      },
      delay
    );
}

// ============================================================
// EVENTSUB SUBSCRIPTION
// ============================================================

async function createEventSubSubscription({
  token,
  sessionId,
  type,
  version,
  condition
}) {
  try {
    const response =
      await fetch(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          method: 'POST',

          headers: {
            ...twitchHeaders(token),

            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              type,
              version,
              condition,

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
        `❌ EventSub ${type}:`,
        data
      );

      return false;
    }

    console.log(
      `✅ EventSub ${type} activé.`
    );

    return true;

  } catch (error) {
    console.error(
      `❌ EventSub ${type}:`,
      error.message
    );

    return false;
  }
}

// ============================================================
// EVENTSUB STREAM
// ============================================================

async function connectTwitchStreamEventSub(
  websocketUrl =
    'wss://eventsub.wss.twitch.tv/ws',
  isReconnect = false
) {
  if (
    shuttingDown ||
    !twitchAccessToken ||
    !twitchUserId
  ) {
    return null;
  }

  if (
    twitchStreamSocket &&
    (
      twitchStreamSocket.readyState ===
        WebSocket.OPEN ||
      twitchStreamSocket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return twitchStreamSocket;
  }

  console.log(
    '🔌 Connexion Twitch EventSub Stream...'
  );

  const ws =
    new WebSocket(
      websocketUrl
    );

  twitchStreamSocket =
    ws;

  ws.on(
    'open',
    () => {
      console.log(
        '🟢 EventSub Stream WebSocket ouvert.'
      );
    }
  );

  ws.on(
    'message',
    async raw => {
      try {
        const message =
          JSON.parse(
            raw.toString()
          );

        const metadata =
          message.metadata || {};

        const type =
          metadata.message_type;

        const messageId =
          metadata.message_id;

        if (messageId) {
          if (
            processedTwitchMessageIds.has(
              messageId
            )
          ) {
            return;
          }

          processedTwitchMessageIds.set(
            messageId,
            Date.now()
          );
        }

        // ------------------------------------------------------
        // WELCOME
        // ------------------------------------------------------

        if (
          type ===
          'session_welcome'
        ) {
          const session =
            message.payload?.session;

          if (!session) {
            return;
          }

          twitchStreamSessionId =
            session.id;

          twitchStreamReconnectAttempt =
            0;

          console.log(
            `✅ EventSub Stream session : ${session.id}`
          );

          // Lors d'une reconnexion via reconnect_url,
          // Twitch conserve automatiquement les subscriptions.
          if (isReconnect) {
            return;
          }

          await createEventSubSubscription({
            token:
              twitchAccessToken,

            sessionId:
              session.id,

            type:
              'stream.online',

            version:
              '1',

            condition: {
              broadcaster_user_id:
                twitchUserId
            }
          });

          return;
        }

        // ------------------------------------------------------
        // KEEPALIVE
        // ------------------------------------------------------

        if (
          type ===
          'session_keepalive'
        ) {
          return;
        }

        // ------------------------------------------------------
        // RECONNECT
        // ------------------------------------------------------

        if (
          type ===
          'session_reconnect'
        ) {
          const reconnectUrl =
            message.payload?.session
              ?.reconnect_url;

          if (!reconnectUrl) {
            return;
          }

          console.warn(
            '🔄 Twitch demande une reconnexion Stream.'
          );

          await connectTwitchStreamEventSub(
            reconnectUrl,
            true
          );

          return;
        }

        // ------------------------------------------------------
        // REVOCATION
        // ------------------------------------------------------

        if (
          type ===
          'revocation'
        ) {
          console.error(
            '🔴 EventSub Stream révoqué :',
            message.payload?.subscription
          );

          return;
        }

        // ------------------------------------------------------
        // NOTIFICATION
        // ------------------------------------------------------

        if (
          type !==
          'notification'
        ) {
          return;
        }

        const subscription =
          message.payload?.subscription;

        const event =
          message.payload?.event;

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

        await handleStreamOnline(
          event
        );

      } catch (error) {
        console.error(
          '❌ EventSub Stream message:',
          error.message
        );
      }
    }
  );

  ws.on(
    'error',
    error => {
      console.error(
        '🔴 EventSub Stream WebSocket:',
        error.message
      );
    }
  );

  ws.on(
    'close',
    (code, reason) => {
      if (
        twitchStreamSocket ===
        ws
      ) {
        twitchStreamSocket =
          null;

        twitchStreamSessionId =
          null;
      }

      console.warn(
        `🟠 EventSub Stream fermé. Code=${code} Reason=${
          reason?.toString() || 'aucune'
        }`
      );

      if (!shuttingDown) {
        scheduleStreamReconnect();
      }
    }
  );

  return ws;
}

// ============================================================
// STREAM ONLINE
// ============================================================

async function handleStreamOnline(
  event
) {
  const streamId =
    event.id;

  if (!streamId) {
    return;
  }

  if (
    lastAnnouncedStreamId ===
    streamId
  ) {
    return;
  }

  console.log(
    '🔴 Twitch stream.online reçu.'
  );

  const stream =
    await getTwitchStream(
      twitchUserId
    );

  const data =
    stream || {
      game_name:
        event.category_name ||
        'Jeu non renseigné',

      title:
        event.title ||
        '',

      type:
        event.type ||
        'live',

      started_at:
        event.started_at
    };

  const sent =
    await sendTwitchLiveAnnouncement(
      data,
      twitchUser
    );

  if (sent) {
    lastAnnouncedStreamId =
      streamId;
  }
}

// ============================================================
// EVENTSUB CHAT
// ============================================================

async function connectTwitchChatEventSub(
  websocketUrl =
    'wss://eventsub.wss.twitch.tv/ws',
  isReconnect = false
) {
  if (
    shuttingDown ||
    !twitchChatAccessToken ||
    !twitchUserId ||
    !twitchChatUserId
  ) {
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

  console.log(
    '🔌 Connexion Twitch EventSub Chat...'
  );

  const ws =
    new WebSocket(
      websocketUrl
    );

  twitchChatSocket =
    ws;

  ws.on(
    'open',
    () => {
      console.log(
        '🟢 EventSub Chat WebSocket ouvert.'
      );
    }
  );

  ws.on(
    'message',
    async raw => {
      try {
        const message =
          JSON.parse(
            raw.toString()
          );

        const metadata =
          message.metadata || {};

        const type =
          metadata.message_type;

        const messageId =
          metadata.message_id;

        if (messageId) {
          if (
            processedTwitchMessageIds.has(
              messageId
            )
          ) {
            return;
          }

          processedTwitchMessageIds.set(
            messageId,
            Date.now()
          );
        }

        if (
          type ===
          'session_welcome'
        ) {
          const session =
            message.payload?.session;

          if (!session) {
            return;
          }

          twitchChatSessionId =
            session.id;

          twitchChatReconnectAttempt =
            0;

          console.log(
            `✅ EventSub Chat session : ${session.id}`
          );

          if (isReconnect) {
            return;
          }

          await createEventSubSubscription({
            token:
              twitchChatAccessToken,

            sessionId:
              session.id,

            type:
              'channel.chat.message',

            version:
              '1',

            condition: {
              broadcaster_user_id:
                twitchUserId,

              user_id:
                twitchChatUserId
            }
          });

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
            message.payload?.session
              ?.reconnect_url;

          if (!reconnectUrl) {
            return;
          }

          console.warn(
            '🔄 Twitch demande une reconnexion Chat.'
          );

          await connectTwitchChatEventSub(
            reconnectUrl,
            true
          );

          return;
        }

        if (
          type ===
          'revocation'
        ) {
          console.error(
            '🔴 EventSub Chat révoqué :',
            message.payload?.subscription
          );

          return;
        }

        if (
          type !==
          'notification'
        ) {
          return;
        }

        const subscription =
          message.payload?.subscription;

        const event =
          message.payload?.event;

        if (
          !subscription ||
          !event
        ) {
          return;
        }

        if (
          subscription.type !==
          'channel.chat.message'
        ) {
          return;
        }

        await handleTwitchChatMessage(
          event
        );

      } catch (error) {
        console.error(
          '❌ EventSub Chat message:',
          error.message
        );
      }
    }
  );

  ws.on(
    'error',
    error => {
      console.error(
        '🔴 EventSub Chat WebSocket:',
        error.message
      );
    }
  );

  ws.on(
    'close',
    (code, reason) => {
      if (
        twitchChatSocket ===
        ws
      ) {
        twitchChatSocket =
          null;

        twitchChatSessionId =
          null;
      }

      console.warn(
        `🟠 EventSub Chat fermé. Code=${code} Reason=${
          reason?.toString() || 'aucune'
        }`
      );

      if (!shuttingDown) {
        scheduleChatReconnect();
      }
    }
  );

  return ws;
}

// ============================================================
// DISCORD LIVE ANNOUNCEMENT
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

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      console.error(
        '❌ Salon Twitch invalide.'
      );

      return false;
    }

    const gameName =
      stream.game_name ||
      'Jeu non renseigné';

    const title =
      stream.title ||
      '';

    const twitchUrl =
      `https://www.twitch.tv/${TWITCH_USERNAME}`;

    const embed =
      new EmbedBuilder()
        .setColor(0x9146FF)
        .setTitle(
          '🔴 ASTER ANGXL EST EN LIVE !'
        )
        .setURL(
          twitchUrl
        )
        .setDescription(
          `Il vient de lancer un live sur **${gameName}** 🎮\n\n` +
          (
            title
              ? `**${safeText(title, 250)}**\n\n`
              : ''
          ) +
          `Passe lui faire un coucou 👀\n\n` +
          `👉 [**Regarder le live**](${twitchUrl})`
        )
        .setFooter({
          text:
            'Nexus • Twitch'
        })
        .setTimestamp();

    if (
      user?.profile_image_url
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
      '❌ Annonce Twitch:',
      error.message
    );

    return false;
  }
}

// ============================================================
// PERMISSIONS DISCORD
// ============================================================

function canModerate(
  interaction
) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageMessages
    )
  );
}

function isAdmin(
  interaction
) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function canUseSanctions(
  interaction
) {
  return (
    canModerate(interaction) ||
    isAdmin(interaction)
  );
}

// ============================================================
// SANCTION NORMALIZATION
// ============================================================

const VALID_SANCTIONS = new Set([
  'Avertissement',
  'Timeout',
  'Kick',
  'Ban'
]);

function normalizeSanction(
  value
) {
  const clean =
    String(value || '')
      .trim();

  if (
    VALID_SANCTIONS.has(
      clean
    )
  ) {
    return clean;
  }

  return null;
}

// ============================================================
// SANCTION EXECUTION
// ============================================================

async function executeSanction(
  request
) {
  const guild =
    client.guilds.cache.get(
      request.guildId
    );

  if (!guild) {
    throw new Error(
      'Serveur Discord introuvable.'
    );
  }

  const targetUser =
    await client.users.fetch(
      request.targetUserId
    );

  if (
    targetUser.id ===
    guild.ownerId
  ) {
    throw new Error(
      'Impossible de sanctionner le propriétaire du serveur.'
    );
  }

  let member = null;

  try {
    member =
      await guild.members.fetch(
        request.targetUserId
      );
  } catch {
    member = null;
  }

  const reason =
    safeText(
      request.reason,
      450
    ) ||
    'Sanction validée par la modération.';

  switch (
    request.finalSanction
  ) {
    case 'Avertissement': {
      const channel =
        await client.channels.fetch(
          SANCTION_CHANNEL_ID
        );

      if (
        channel?.isTextBased()
      ) {
        await channel.send({
          content:
            `⚠️ **Avertissement officiel** — <@${request.targetUserId}>\n` +
            `Raison : ${reason}`
        });
      }

      try {
        await targetUser.send(
          `⚠️ Tu as reçu un avertissement sur **${guild.name}**.\nRaison : ${reason}`
        );
      } catch {
        // DM fermé : on continue.
      }

      return {
        success: true,
        action:
          'Avertissement'
      };
    }

    case 'Timeout': {
      if (!member) {
        throw new Error(
          'Le membre n’est plus présent sur le serveur.'
        );
      }

      if (!member.moderatable) {
        throw new Error(
          'Le bot ne peut pas timeout ce membre : hiérarchie ou permissions insuffisantes.'
        );
      }

      await member.timeout(
        DEFAULT_TIMEOUT_MS,
        reason
      );

      return {
        success: true,
        action:
          `Timeout ${Math.round(
            DEFAULT_TIMEOUT_MS / 60000
          )} min`
      };
    }

    case 'Kick': {
      if (!member) {
        throw new Error(
          'Le membre n’est plus présent sur le serveur.'
        );
      }

      if (!member.kickable) {
        throw new Error(
          'Le bot ne peut pas expulser ce membre : hiérarchie ou permissions insuffisantes.'
        );
      }

      await member.kick(
        reason
      );

      return {
        success: true,
        action:
          'Kick'
      };
    }

    case 'Ban': {
      if (member && !member.bannable) {
        throw new Error(
          'Le bot ne peut pas bannir ce membre : hiérarchie ou permissions insuffisantes.'
        );
      }

      await guild.members.ban(
        request.targetUserId,
        {
          deleteMessageSeconds:
            0,

          reason
        }
      );

      return {
        success: true,
        action:
          'Ban'
      };
    }

    default:
      throw new Error(
        'Type de sanction invalide.'
      );
  }
}

// ============================================================
// CREATION DEMANDE SANCTION
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

    // Evite les demandes automatiques en boucle.
    if (
      source === 'automatic'
    ) {
      const last =
        sanctionCooldowns.get(
          targetUser.id
        );

      if (
        last &&
        Date.now() - last <
          SANCTION_COOLDOWN
      ) {
        return null;
      }

      sanctionCooldowns.set(
        targetUser.id,
        Date.now()
      );
    }

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      throw new Error(
        'Salon de sanctions invalide.'
      );
    }

    const requestId =
      `${Date.now()}_${targetUser.id}`;

    const initialSanction =
      normalizeSanction(
        proposedSanction
      ) ||
      'Avertissement';

    const request = {
      id:
        requestId,

      guildId:
        guild.id,

      targetUserId:
        targetUser.id,

      targetTag:
        targetUser.tag ||
        targetUser.username,

      proposedSanction:
        initialSanction,

      finalSanction:
        initialSanction,

      reason:
        safeText(
          reason,
          500
        ),

      source,

      detectedMessage:
        detectedMessage
          ? safeText(
              detectedMessage,
              1000
            )
          : null,

      yesVotes:
        new Set(),

      noVotes:
        new Set(),

      status:
        'pending',

      messageId:
        null,

      createdAt:
        Date.now(),

      finalizedAt:
        null,

      execution:
        null
    };

    const sourceText =
      source === 'automatic'
        ? '🤖 Auto-modération'
        : `👮 Modérateur : <@${source}>`;

    const embed =
      buildSanctionEmbed(
        request,
        sourceText
      );

    const buttons =
      buildSanctionButtons(
        requestId
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
      '🚨 Demande de sanction créée:',
      requestId
    );

    return request;

  } catch (error) {
    console.error(
      '❌ Création sanction:',
      error.message
    );

    return null;
  }
}

// ============================================================
// EMBED SANCTION
// ============================================================

function buildSanctionEmbed(
  request,
  sourceText = null
) {
  const source =
    sourceText ||
    (
      request.source ===
      'automatic'
        ? '🤖 Auto-modération'
        : `👮 Modérateur : <@${request.source}>`
    );

  const statusText =
    request.status ===
    'pending'
      ? '⏳ **EN ATTENTE**'
      : request.status ===
        'approved'
        ? '🟢 **VALIDÉE**'
        : '🔴 **REFUSÉE**';

  const embed =
    new EmbedBuilder()
      .setColor(
        request.status ===
        'pending'
          ? 0xFFA500
          : request.status ===
            'approved'
            ? 0x00FF00
            : 0xFF0000
      )

      .setTitle(
        '🚨 Demande de sanction'
      )

      .setDescription(
        `👤 **Membre :** <@${request.targetUserId}>\n\n` +
        `⚠️ **Sanction :** ${request.finalSanction}\n\n` +
        `📝 **Raison :** ${request.reason}\n\n` +
        `🔎 **Source :** ${source}\n\n` +
        `📌 **État :** ${statusText}`
      )

      .addFields({
        name:
          '🗳️ Votes',

        value:
          `🟢 Pour : **${request.yesVotes.size}**\n` +
          `🔴 Contre : **${request.noVotes.size}**\n\n` +
          'Validation automatique à **3 votes Pour**.'
      })

      .setFooter({
        text:
          `Nexus • ID ${request.id}`
      })

      .setTimestamp(
        new Date(
          request.createdAt
        )
      );

  if (
    request.detectedMessage
  ) {
    embed.addFields({
      name:
        '💬 Message concerné',

      value:
        request.detectedMessage
    });
  }

  if (
    request.execution
  ) {
    embed.addFields({
      name:
        '⚙️ Exécution',

      value:
        request.execution
    });
  }

  return embed;
}

// ============================================================
// BOUTONS SANCTION
// ============================================================

function buildSanctionButtons(
  requestId,
  disabled = false
) {
  return new ActionRowBuilder()
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
        )
        .setDisabled(
          disabled
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
        )
        .setDisabled(
          disabled
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
        .setDisabled(
          disabled
        )
    );
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

    await message.edit({
      embeds: [
        buildSanctionEmbed(
          request
        )
      ],

      components: [
        buildSanctionButtons(
          request.id,
          request.status !==
            'pending'
        )
      ]
    });

  } catch (error) {
    console.error(
      '❌ Update sanction:',
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
  if (
    request.status !==
    'approved'
  ) {
    await updateSanctionMessage(
      request
    );

    return;
  }

  if (
    request.finalizedAt
  ) {
    return;
  }

  try {
    request.finalizedAt =
      Date.now();

    const result =
      await executeSanction(
        request
      );

    request.execution =
      `✅ ${result.action}`;

  } catch (error) {
    request.execution =
      `❌ Échec : ${safeText(
        error.message,
        500
      )}`;

    console.error(
      `❌ Exécution sanction ${request.id}:`,
      error.message
    );
  }

  await updateSanctionMessage(
    request
  );

  console.log(
    `📌 Sanction ${request.id} finalisée:`,
    request.execution
  );
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
    !canUseSanctions(
      interaction
    )
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

  // Administrateur : décision immédiate.
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

    if (
      request.status ===
      'approved'
    ) {
      await finalizeSanctionRequest(
        request
      );
    } else {
      await updateSanctionMessage(
        request
      );
    }

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

  if (
    vote === 'yes'
  ) {
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
        '🟢 3 votes Pour atteints. Sanction validée.',

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
    !canUseSanctions(
      interaction
    )
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

  const modal =
    new ModalBuilder()
      .setCustomId(
        `sanction_modal_${requestId}`
      )
      .setTitle(
        'Modifier la sanction'
      );

  const sanctionInput =
    new TextInputBuilder()
      .setCustomId(
        'sanction'
      )
      .setLabel(
        'Sanction'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(true)
      .setValue(
        request.finalSanction
      )
      .setPlaceholder(
        'Avertissement, Timeout, Kick ou Ban'
      );

  const reasonInput =
    new TextInputBuilder()
      .setCustomId(
        'reason'
      )
      .setLabel(
        'Raison'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setValue(
        request.reason.slice(
          0,
          1000
        )
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        sanctionInput
      ),

    new ActionRowBuilder()
      .addComponents(
        reasonInput
      )
  );

  await interaction.showModal(
    modal
  );
}

// ============================================================
// MODAL INTERACTION
// ============================================================

async function handleSanctionModal(
  interaction,
  requestId
) {
  if (
    !canUseSanctions(
      interaction
    )
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

  const sanction =
    normalizeSanction(
      interaction.fields.getTextInputValue(
        'sanction'
      )
    );

  const reason =
    safeText(
      interaction.fields.getTextInputValue(
        'reason'
      ),
      500
    );

  if (!sanction) {
    await interaction.reply({
      content:
        '❌ Sanction invalide. Utilise : Avertissement, Timeout, Kick ou Ban.',

      ephemeral: true
    });

    return;
  }

  if (!reason) {
    await interaction.reply({
      content:
        '❌ La raison est obligatoire.',

      ephemeral: true
    });

    return;
  }

  request.finalSanction =
    sanction;

  request.reason =
    reason;

  // Une modification invalide les anciens votes.
  request.yesVotes.clear();
  request.noVotes.clear();

  await updateSanctionMessage(
    request
  );

  await interaction.reply({
    content:
      '✅ Sanction et raison modifiées. Les votes ont été réinitialisés.',

    ephemeral: true
  });
}

// ============================================================
// DISCORD INTERACTIONS
// ============================================================

client.on(
  'interactionCreate',
  async interaction => {
    try {
      // --------------------------------------------------------
      // SLASH
      // --------------------------------------------------------

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
          !canUseSanctions(
            interaction
          )
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

        if (
          target.id ===
          guild.ownerId
        ) {
          await interaction.reply({
            content:
              '❌ Impossible de sanctionner le propriétaire du serveur.',

            ephemeral: true
          });

          return;
        }

        let member;

        try {
          member =
            await guild.members.fetch(
              target.id
            );
        } catch {
          member = null;
        }

        if (
          member?.permissions.has(
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

      // --------------------------------------------------------
      // MODAL
      // --------------------------------------------------------

      if (
        interaction.isModalSubmit()
      ) {
        if (
          !interaction.customId.startsWith(
            'sanction_modal_'
          )
        ) {
          return;
        }

        const requestId =
          interaction.customId.slice(
            'sanction_modal_'.length
          );

        await handleSanctionModal(
          interaction,
          requestId
        );

        return;
      }

      // --------------------------------------------------------
      // BUTTON
      // --------------------------------------------------------

      if (
        interaction.isButton()
      ) {
        const match =
          interaction.customId.match(
            /^sanction_(yes|no|modify)_(.+)$/
          );

        if (!match) {
          return;
        }

        const action =
          match[1];

        const requestId =
          match[2];

        if (
          action === 'yes'
        ) {
          await handleSanctionVote(
            interaction,
            requestId,
            'yes'
          );

          return;
        }

        if (
          action === 'no'
        ) {
          await handleSanctionVote(
            interaction,
            requestId,
            'no'
          );

          return;
        }

        if (
          action === 'modify'
        ) {
          await handleModifySanction(
            interaction,
            requestId
          );
        }
      }

    } catch (error) {
      console.error(
        '❌ Interaction:',
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
      if (
        shuttingDown ||
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const content =
        String(
          message.content || ''
        ).trim();

      if (!content) {
        return;
      }

      const detected =
        detectModeration(
          content
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
        `[AUTO-MOD] ${message.author.tag} | générales=${generalCount} | sensibles=${sensitiveCount}`
      );

      // --------------------------------------------------------
      // SENSIBLE
      // --------------------------------------------------------

      if (
        detected.sensitive
      ) {
        const last =
          sanctionCooldowns.get(
            message.author.id
          );

        if (
          last &&
          Date.now() - last <
            SANCTION_COOLDOWN
        ) {
          return;
        }

        await createSanctionRequest({
          guild:
            message.guild,

          targetUser:
            message.author,

          proposedSanction:
            'Avertissement',

          reason:
            'Détection automatique d’un contenu potentiellement discriminatoire. Contexte à examiner.',

          source:
            'automatic',

          detectedMessage:
            content
        });

        return;
      }

      // --------------------------------------------------------
      // INSULTES
      // --------------------------------------------------------

      if (
        generalCount >=
        GENERAL_INSULT_THRESHOLD
      ) {
        await createSanctionRequest({
          guild:
            message.guild,

          targetUser:
            message.author,

          proposedSanction:
            'Timeout',

          reason:
            `${generalCount} messages contenant des insultes détectés en moins d'une minute.`,

          source:
            'automatic',

          detectedMessage:
            content
        });
      }

    } catch (error) {
      console.error(
        '❌ Auto-mod:',
        error.message
      );
    }
  }
);

// ============================================================
// SLASH COMMAND
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
// REGISTER COMMANDS
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

    const route =
      DISCORD_GUILD_ID
        ? Routes.applicationGuildCommands(
            DISCORD_CLIENT_ID,
            DISCORD_GUILD_ID
          )
        : Routes.applicationCommands(
            DISCORD_CLIENT_ID
          );

    await rest.put(
      route,
      {
        body: [
          sanctionCommand.toJSON()
        ]
      }
    );

    console.log(
      DISCORD_GUILD_ID
        ? '✅ /sanction enregistrée sur le serveur.'
        : '✅ /sanction enregistrée globalement.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Enregistrement commandes:',
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
      '🔴 ERREUR DISCORD:',
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
  'shardReady',
  id => {
    discordReadyAt =
      Date.now();

    console.log(
      '🟢 Shard prêt:',
      id
    );
  }
);

client.on(
  'shardDisconnect',
  (event, id) => {
    console.error(
      '🔴 Discord shard déconnecté:',
      id,
      event?.code
    );
  }
);

client.on(
  'shardReconnecting',
  id => {
    console.warn(
      '🟠 Discord reconnexion:',
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
      '🟢 Discord Gateway reconnecté:',
      id,
      'events:',
      replayedEvents
    );
  }
);

// ============================================================
// HTTP
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

        // ------------------------------------------------------
        // ROOT
        // ------------------------------------------------------

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

        // ------------------------------------------------------
        // HEALTH
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/health'
        ) {
          const discordStatus =
            client.ws.status;

          const discordReady =
            discordStatus ===
            Status.Ready;

          const streamConnected =
            Boolean(
              twitchStreamSocket &&
              twitchStreamSocket.readyState ===
                WebSocket.OPEN
            );

          const chatConnected =
            Boolean(
              twitchChatSocket &&
              twitchChatSocket.readyState ===
                WebSocket.OPEN
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
                client.user?.tag ||
                null,

              uptime:
                process.uptime(),

              twitch: {
                username:
                  TWITCH_USERNAME,

                userId:
                  twitchUserId,

                streamEventSubConnected:
                  streamConnected,

                chatEventSubConnected:
                  chatConnected,

                apiTokenConfigured:
                  Boolean(
                    twitchAccessToken
                  ),

                chatTokenConfigured:
                  Boolean(
                    twitchChatAccessToken
                  ),

                chatUserId:
                  twitchChatUserId
              },

              memory: {
                detections:
                  detectionTracker.size,

                sanctionRequests:
                  sanctionRequests.size
              },

              shuttingDown,

              timestamp:
                new Date().toISOString()
            })
          );

          return;
        }

        // ------------------------------------------------------
        // TWITCH API OAUTH LOGIN
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/twitch/login'
        ) {
          if (
            !TWITCH_CLIENT_ID
          ) {
            res.writeHead(
              500
            );

            res.end(
              'TWITCH_CLIENT_ID absent.'
            );

            return;
          }

          const params =
            new URLSearchParams({
              response_type:
                'code',

              client_id:
                TWITCH_CLIENT_ID,

              redirect_uri:
                TWITCH_REDIRECT_URI,

              scope:
                '',

              force_verify:
                'true'
            });

          res.writeHead(
            302,
            {
              Location:
                'https://id.twitch.tv/oauth2/authorize?' +
                params.toString()
            }
          );

          res.end();

          return;
        }

        // ------------------------------------------------------
        // TWITCH CHAT LOGIN
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/twitch/chat/login'
        ) {
          if (
            !TWITCH_CLIENT_ID
          ) {
            res.writeHead(
              500
            );

            res.end(
              'TWITCH_CLIENT_ID absent.'
            );

            return;
          }

          const params =
            new URLSearchParams({
              response_type:
                'code',

              client_id:
                TWITCH_CLIENT_ID,

              redirect_uri:
                TWITCH_CHAT_REDIRECT_URI,

              scope:
                [
                  'user:read:chat',
                  'user:write:chat',
                  'user:bot',
                  'channel:bot'
                ].join(' '),

              force_verify:
                'true'
            });

          res.writeHead(
            302,
            {
              Location:
                'https://id.twitch.tv/oauth2/authorize?' +
                params.toString()
            }
          );

          res.end();

          return;
        }

        // ------------------------------------------------------
        // TWITCH CHAT CALLBACK
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/twitch/chat/callback'
        ) {
          await handleTwitchOAuthCallback(
            req,
            res,
            url,
            true
          );

          return;
        }

        // ------------------------------------------------------
        // TWITCH API CALLBACK
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/twitch/callback'
        ) {
          await handleTwitchOAuthCallback(
            req,
            res,
            url,
            false
          );

          return;
        }

        // ------------------------------------------------------
        // 404
        // ------------------------------------------------------

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
          '❌ HTTP:',
          error.message
        );

        if (
          !res.headersSent
        ) {
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
// OAUTH CALLBACK
// ============================================================

async function handleTwitchOAuthCallback(
  req,
  res,
  url,
  isChat
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
      `<h1>❌ Autorisation Twitch refusée</h1><p>${escapeHtml(error)}</p>`
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

  const redirectUri =
    isChat
      ? TWITCH_CHAT_REDIRECT_URI
      : TWITCH_REDIRECT_URI;

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

              code,

              grant_type:
                'authorization_code',

              redirect_uri:
                redirectUri
            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      console.error(
        '❌ OAuth Twitch:',
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
        '<h1>❌ Erreur OAuth Twitch</h1><p>Regarde les logs Render.</p>'
      );

      return;
    }

    if (isChat) {
      twitchChatAccessToken =
        data.access_token;

      twitchChatRefreshToken =
        data.refresh_token ||
        '';

      process.env.TWITCH_CHAT_ACCESS_TOKEN =
        twitchChatAccessToken;

      process.env.TWITCH_CHAT_REFRESH_TOKEN =
        twitchChatRefreshToken;

      const validation =
        await validateTwitchToken(
          twitchChatAccessToken
        );

      twitchChatUserId =
        validation?.user_id ||
        null;

      twitchChatUser =
        twitchChatUserId
          ? await getTwitchUserById(
              twitchChatUserId,
              twitchChatAccessToken
            )
          : null;

      console.log(
        '✅ OAuth Twitch Chat réussi.'
      );

      console.log(
        'Scopes Chat:',
        validation?.scopes || []
      );

      if (
        twitchChatSocket
      ) {
        try {
          twitchChatSocket.close(
            1000,
            'OAuth refresh'
          );
        } catch {}
      }

      twitchChatSocket =
        null;

      await sleep(500);

      await connectTwitchChatEventSub();

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/html; charset=utf-8'
        }
      );

      res.end(`
        <!doctype html>
        <html lang="fr">
        <head>
          <meta charset="utf-8">
          <title>Nexus Twitch</title>
        </head>
        <body>
          <h1>✅ Twitch Chat connecté !</h1>
          <p>Nexus a obtenu l'autorisation Twitch.</p>
          <p>Tu peux fermer cette page.</p>
          <p><strong>Important :</strong> si tu es sur Render sans stockage persistant, mets les nouveaux tokens dans les variables d'environnement.</p>
        </body>
        </html>
      `);

      return;
    }

    twitchAccessToken =
      data.access_token;

    process.env.TWITCH_ACCESS_TOKEN =
      twitchAccessToken;

    if (
      data.refresh_token
    ) {
      twitchRefreshToken =
        data.refresh_token;

      process.env.TWITCH_REFRESH_TOKEN =
        twitchRefreshToken;
    }

    console.log(
      '✅ OAuth Twitch API réussi.'
    );

    res.writeHead(
      200,
      {
        'Content-Type':
          'text/html; charset=utf-8'
      }
    );

    res.end(`
      <h1>✅ Twitch connecté !</h1>
      <p>Tu peux fermer cette page.</p>
      <p>Si tu es sur Render sans stockage persistant, mets les tokens dans les variables d'environnement.</p>
    `);

  } catch (error) {
    console.error(
      '❌ OAuth Twitch:',
      error.message
    );

    res.writeHead(
      500
    );

    res.end(
      'Erreur OAuth Twitch.'
    );
  }
}

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
        '⚠️ TWITCH_ACCESS_TOKEN invalide.'
      );

      if (
        twitchRefreshToken
      ) {
        await refreshTwitchApiToken();
      }
    }
  } else if (
    twitchRefreshToken
  ) {
    await refreshTwitchApiToken();
  }

  // ----------------------------------------------------------
  // CHANNEL USER
  // ----------------------------------------------------------

  if (
    twitchAccessToken
  ) {
    twitchUser =
      await getTwitchUserByLogin(
        TWITCH_USERNAME
      );

    if (
      twitchUser
    ) {
      twitchUserId =
        twitchUser.id;

      console.log(
        `🎮 Twitch : ${twitchUser.login}`
      );

      console.log(
        `🆔 Twitch ID : ${twitchUserId}`
      );

      await connectTwitchStreamEventSub();
    } else {
      console.error(
        '❌ Impossible de récupérer le broadcaster Twitch.'
      );
    }
  } else {
    console.error(
      '❌ Aucun token Twitch API valide.'
    );
  }

  // ----------------------------------------------------------
  // CHAT TOKEN
  // ----------------------------------------------------------

  if (
    twitchChatAccessToken
  ) {
    let validation =
      await validateTwitchToken(
        twitchChatAccessToken
      );

    if (!validation) {
      console.warn(
        '⚠️ TWITCH_CHAT_ACCESS_TOKEN invalide.'
      );

      if (
        twitchChatRefreshToken
      ) {
        await refreshTwitchChatToken();

        validation =
          await validateTwitchToken(
            twitchChatAccessToken
          );
      }
    }

    if (
      validation?.user_id
    ) {
      twitchChatUserId =
        validation.user_id;

      twitchChatUser =
        await getTwitchUserById(
          twitchChatUserId,
          twitchChatAccessToken
        );

      console.log(
        `🤖 Twitch Chat User : ${
          twitchChatUser?.login ||
          twitchChatUserId
        }`
      );

      console.log(
        '🔑 Twitch Chat scopes:',
        validation.scopes || []
      );

      await connectTwitchChatEventSub();

    } else {
      console.warn(
        '⚠️ Impossible de valider le token Twitch Chat.'
      );
    }

  } else if (
    twitchChatRefreshToken
  ) {
    await refreshTwitchChatToken();

    if (
      twitchChatAccessToken
    ) {
      const validation =
        await validateTwitchToken(
          twitchChatAccessToken
        );

      twitchChatUserId =
        validation?.user_id ||
        null;

      if (
        twitchChatUserId
      ) {
        twitchChatUser =
          await getTwitchUserById(
            twitchChatUserId,
            twitchChatAccessToken
          );

        await connectTwitchChatEventSub();
      }
    }

  } else {
    console.warn(
      '⚠️ Twitch Chat non configuré.'
    );

    console.warn(
      '👉 Autorise Twitch ici : /twitch/chat/login'
    );
  }
}

// ============================================================
// INITIALISATION DISCORD
// ============================================================

async function initializeDiscord() {
  if (!DISCORD_TOKEN) {
    console.error(
      '❌ DISCORD_TOKEN absent.'
    );

    return false;
  }

  try {
    console.log(
      '🔐 Connexion à Discord...'
    );

    await client.login(
      DISCORD_TOKEN
    );

    console.log(
      '✅ Login Discord envoyé.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Login Discord:',
      error.message
    );

    return false;
  }
}

// ============================================================
// WATCHDOG
// ============================================================

setInterval(
  () => {
    if (
      shuttingDown
    ) {
      return;
    }

    try {
      console.log(
        `[WATCHDOG] ` +
        `Discord=${getDiscordStatusName(client.ws.status)} | ` +
        `ping=${client.ws.ping}ms | ` +
        `uptime=${Math.floor(process.uptime())}s | ` +
        `EventSubStream=${
          twitchStreamSocket?.readyState ===
          WebSocket.OPEN
            ? 'connected'
            : 'disconnected'
        } | ` +
        `EventSubChat=${
          twitchChatSocket?.readyState ===
          WebSocket.OPEN
            ? 'connected'
            : 'disconnected'
        }`
      );

    } catch (error) {
      console.error(
        '❌ Watchdog:',
        error.message
      );
    }
  },
  30000
);

// ============================================================
// HEARTBEAT
// ============================================================

setInterval(
  () => {
    if (
      !shuttingDown
    ) {
      console.log(
        `[PROCESS] Nexus actif depuis ${Math.floor(
          process.uptime()
        )} secondes.`
      );
    }
  },
  30000
);

// ============================================================
// NETTOYAGE
// ============================================================

setInterval(
  () => {
    const now =
      Date.now();

    // EventSub duplicate IDs
    for (
      const [
        id,
        timestamp
      ]
      of processedTwitchMessageIds
    ) {
      if (
        now - timestamp >
        10 * 60 * 1000
      ) {
        processedTwitchMessageIds.delete(
          id
        );
      }
    }

    // Détections
    for (
      const [
        userId,
        data
      ]
      of detectionTracker
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

    // Cooldowns
    for (
      const [
        userId,
        timestamp
      ]
      of sanctionCooldowns
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

    // Sanctions terminées très anciennes
    if (
      sanctionRequests.size >
      1000
    ) {
      const entries =
        Array.from(
          sanctionRequests.entries()
        );

      entries
        .filter(
          ([, request]) =>
            request.status !==
              'pending' &&
            now - request.createdAt >
              60 * 60 * 1000
        )
        .slice(0, 500)
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
  'Discord Token présent:',
  Boolean(
    DISCORD_TOKEN
  )
);

console.log(
  'Discord Client ID présent:',
  Boolean(
    DISCORD_CLIENT_ID
  )
);

console.log(
  'Twitch Client ID présent:',
  Boolean(
    TWITCH_CLIENT_ID
  )
);

console.log(
  'Twitch Client Secret présent:',
  Boolean(
    TWITCH_CLIENT_SECRET
  )
);

console.log(
  'Twitch API Access Token présent:',
  Boolean(
    twitchAccessToken
  )
);

console.log(
  'Twitch API Refresh Token présent:',
  Boolean(
    twitchRefreshToken
  )
);

console.log(
  'Twitch Chat Access Token présent:',
  Boolean(
    twitchChatAccessToken
  )
);

console.log(
  'Twitch Chat Refresh Token présent:',
  Boolean(
    twitchChatRefreshToken
  )
);

console.log(
  'Twitch Username:',
  TWITCH_USERNAME
);

console.log(
  'Discord Invite présent:',
  Boolean(
    DISCORD_INVITE
  )
);

console.log(
  '============================================'
);

// ============================================================
// START
// ============================================================

(async () => {
  await initializeDiscord();

  await initializeTwitch();

  console.log(
    '🚀 Nexus initialisé.'
  );
})().catch(
  error => {
    console.error(
      '🔴 Initialisation globale:',
      error
    );
  }
);

// ============================================================
// PROCESS ERRORS
// ============================================================

process.on(
  'unhandledRejection',
  error => {
    console.error(
      '🔴 UNHANDLED REJECTION:',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      '🔴 UNCAUGHT EXCEPTION:',
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

  // EventSub stream
  if (
    twitchStreamReconnectTimer
  ) {
    clearTimeout(
      twitchStreamReconnectTimer
    );

    twitchStreamReconnectTimer =
      null;
  }

  if (
    twitchStreamSocket
  ) {
    try {
      twitchStreamSocket.close(
        1000,
        'Nexus shutdown'
      );
    } catch {}
  }

  twitchStreamSocket =
    null;

  // EventSub chat
  if (
    twitchChatReconnectTimer
  ) {
    clearTimeout(
      twitchChatReconnectTimer
    );

    twitchChatReconnectTimer =
      null;
  }

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

  // Discord
  try {
    client.destroy();
  } catch {}

  // HTTP
  await new Promise(
    resolve => {
      let done = false;

      const finish =
        () => {
          if (done) {
            return;
          }

          done = true;

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
  () =>
    gracefulShutdown(
      'SIGTERM'
    )
);

process.on(
  'SIGINT',
  () =>
    gracefulShutdown(
      'SIGINT'
    )
);
```
