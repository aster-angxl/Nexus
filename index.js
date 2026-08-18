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

const TWITCH_REDIRECT_URI =
  'https://nexus-bpsk.onrender.com/twitch/callback';

const TWITCH_USERNAME =
  'aster_angxl';

const STREAM_CHANNEL_ID =
  '1532589426297929799';

const SANCTION_CHANNEL_ID =
  '1538498193728475197';


// ============================================================
// AUTO-MODÉRATION
// ============================================================

const GENERAL_INSULT_THRESHOLD = 3;

const DETECTION_WINDOW =
  60 * 1000;

const SANCTION_COOLDOWN =
  5 * 60 * 1000;

const GENERAL_INSULTS = [
  'pute',
  'salope',
  'encule',
  'enculé'
];

// Ajoute ici les mots sensibles si nécessaire.
const SENSITIVE_PATTERNS = [];


// ============================================================
// MÉMOIRE
// ============================================================

let lastAnnouncedStreamId = null;

const detectionTracker =
  new Map();

const sanctionCooldowns =
  new Map();

const sanctionRequests =
  new Map();


// ============================================================
// ÉTAT DU PROCESSUS
// ============================================================

let shuttingDown = false;

let discordReadyAt = null;

let lastDiscordReadyAt = null;

let twitchEventSubSocket = null;

let twitchEventSubConnecting = false;

let twitchReconnectTimer = null;


// ============================================================
// CLIENT DISCORD
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

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.,!?;:/\\]+/g, ' ')
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
// AUTO-MODÉRATION
// ============================================================

function detectModeration(content) {
  let general = false;
  let sensitive = false;

  for (const word of GENERAL_INSULTS) {
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


// ============================================================
// ENREGISTRER UNE DÉTECTION
// ============================================================

function registerDetection(
  userId,
  type
) {
  const now = Date.now();

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
// TWITCH — REFRESH TOKEN
// ============================================================

async function refreshTwitchToken() {
  const refreshToken =
    process.env.TWITCH_REFRESH_TOKEN;

  if (!refreshToken) {
    console.error(
      '❌ TWITCH_REFRESH_TOKEN absent.'
    );

    return false;
  }

  if (
    !TWITCH_CLIENT_ID ||
    !TWITCH_CLIENT_SECRET
  ) {
    console.error(
      '❌ Identifiants Twitch incomplets.'
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
        '❌ Erreur renouvellement Twitch :',
        data.message ||
          'Erreur inconnue'
      );

      return false;
    }

    process.env.TWITCH_ACCESS_TOKEN =
      data.access_token;

    console.log(
      '✅ Access Token Twitch renouvelé.'
    );

    /*
     * IMPORTANT :
     *
     * Twitch peut fournir un nouveau
     * refresh_token.
     *
     * Ici on le conserve en mémoire
     * pour le processus actuel.
     *
     * Si Render redémarre le service,
     * il faudra également mettre ce
     * nouveau refresh token dans les
     * variables d'environnement persistantes.
     */
    if (data.refresh_token) {
      process.env.TWITCH_REFRESH_TOKEN =
        data.refresh_token;

      console.log(
        '🔄 Nouveau Refresh Token Twitch reçu.'
      );

      console.warn(
        '⚠️ Le nouveau Refresh Token doit être sauvegardé dans Render pour survivre à un redémarrage.'
      );
    }

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur connexion Twitch :',
      error.message
    );

    return false;
  }
}


// ============================================================
// TWITCH — UTILISATEUR
// ============================================================

async function getTwitchUserId(
  username
) {
  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;

  if (!accessToken) {
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
        '❌ Utilisateur Twitch introuvable :',
        data.message ||
          'Erreur inconnue'
      );

      return null;
    }

    console.log(
      'Compte Twitch trouvé :',
      data.data[0].login
    );

    return data.data[0].id;

  } catch (error) {
    console.error(
      '❌ Erreur utilisateur Twitch :',
      error.message
    );

    return null;
  }
}


// ============================================================
// TWITCH — PROFIL
// ============================================================

async function getTwitchUser(
  userId
) {
  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;

  if (!accessToken) {
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
// TWITCH — LIVE
// ============================================================

async function getTwitchStream(
  userId
) {
  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;

  if (!accessToken) {
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
        '❌ Erreur Twitch streams :',
        data.message ||
          'Erreur inconnue'
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
      '❌ Erreur API Twitch streams :',
      error.message
    );

    return null;
  }
}


// ============================================================
// TWITCH — ANNONCE LIVE
// ============================================================

async function sendTwitchLiveAnnouncement(
  stream,
  twitchUser
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

    const profileImage =
      twitchUser &&
      twitchUser.profile_image_url
        ? twitchUser.profile_image_url
        : null;

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
          `Passe lui faire un coucou 👀\n\n` +
          `👉 **[Regarder le live](${twitchUrl})**`
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
      embeds: [embed]
    });

    console.log(
      '✅ Annonce Twitch envoyée.'
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
// TWITCH EVENTSUB — SUBSCRIPTION
// ============================================================

async function createStreamOnlineSubscription(
  sessionId,
  userId
) {
  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      '❌ Access Token Twitch absent.'
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
        '❌ Erreur EventSub :',
        data.message ||
          'Erreur inconnue'
      );

      return false;
    }

    console.log(
      '✅ Subscription EventSub créée.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur création EventSub :',
      error.message
    );

    return false;
  }
}


// ============================================================
// TWITCH EVENTSUB — CONNEXION
// ============================================================

function scheduleTwitchReconnect(
  userId
) {
  if (shuttingDown) {
    return;
  }

  if (twitchReconnectTimer) {
    return;
  }

  twitchReconnectTimer =
    setTimeout(
      () => {
        twitchReconnectTimer =
          null;

        if (!shuttingDown) {
          connectTwitchEventSub(
            userId
          );
        }
      },
      5000
    );

  console.log(
    '⏳ Reconnexion Twitch EventSub prévue dans 5 secondes.'
  );
}


function connectTwitchEventSub(
  userId,
  websocketUrl =
    'wss://eventsub.wss.twitch.tv/ws'
) {
  if (shuttingDown) {
    return null;
  }

  if (
    twitchEventSubConnecting ||
    (
      twitchEventSubSocket &&
      (
        twitchEventSubSocket.readyState ===
        WebSocket.OPEN ||
        twitchEventSubSocket.readyState ===
        WebSocket.CONNECTING
      )
    )
  ) {
    console.log(
      'ℹ️ Connexion Twitch EventSub déjà active.'
    );

    return twitchEventSubSocket;
  }

  twitchEventSubConnecting =
    true;

  console.log(
    '🔌 Connexion à Twitch EventSub...'
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
      twitchEventSubConnecting =
        false;

      console.log(
        '✅ Connexion Twitch EventSub ouverte.'
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

        const messageType =
          message.metadata &&
          message.metadata.message_type;

        console.log(
          'EventSub message :',
          messageType
        );

        // ----------------------------------------------------
        // WELCOME
        // ----------------------------------------------------

        if (
          messageType ===
          'session_welcome'
        ) {
          const sessionId =
            message.payload.session.id;

          console.log(
            'Session EventSub reçue.'
          );

          await createStreamOnlineSubscription(
            sessionId,
            userId
          );

          return;
        }

        // ----------------------------------------------------
        // NOTIFICATION
        // ----------------------------------------------------

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
              'stream.online' &&
            event
          ) {
            const streamId =
              event.id;

            console.log(
              '🔴 Nouveau live détecté :',
              streamId
            );

            if (
              lastAnnouncedStreamId ===
              streamId
            ) {
              console.log(
                'ℹ️ Live déjà annoncé.'
              );

              return;
            }

            const stream =
              await getTwitchStream(
                userId
              );

            if (!stream) {
              console.error(
                '❌ Informations du live introuvables.'
              );

              return;
            }

            const twitchUser =
              await getTwitchUser(
                userId
              );

            const sent =
              await sendTwitchLiveAnnouncement(
                stream,
                twitchUser
              );

            if (sent) {
              lastAnnouncedStreamId =
                streamId;
            }
          }

          return;
        }

        // ----------------------------------------------------
        // RECONNECT
        // ----------------------------------------------------

        if (
          messageType ===
          'session_reconnect'
        ) {
          const reconnectUrl =
            message.payload &&
            message.payload.session &&
            message.payload.session.reconnect_url;

          if (reconnectUrl) {
            console.log(
              '🔄 Twitch demande une reconnexion.'
            );

            /*
             * On ferme cette socket.
             * Twitch fournit une URL spéciale
             * permettant de transférer la session.
             */
            try {
              ws.close();
            } catch {}

            setTimeout(
              () => {
                if (!shuttingDown) {
                  connectTwitchEventSub(
                    userId,
                    reconnectUrl
                  );
                }
              },
              1000
            );
          }

          return;
        }

      } catch (error) {
        console.error(
          '❌ Erreur message EventSub :',
          error.message
        );
      }
    }
  );

  ws.on(
    'error',
    error => {
      twitchEventSubConnecting =
        false;

      console.error(
        '❌ Erreur WebSocket Twitch :',
        error.message
      );
    }
  );

  ws.on(
    'close',
    () => {
      twitchEventSubConnecting =
        false;

      if (
        twitchEventSubSocket ===
        ws
      ) {
        twitchEventSubSocket =
          null;
      }

      console.warn(
        '🟠 Connexion Twitch EventSub fermée.'
      );

      if (!shuttingDown) {
        scheduleTwitchReconnect(
          userId
        );
      }
    }
  );

  return ws;
}


// ============================================================
// SANCTIONS — CRÉATION
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
    if (!guild) {
      console.error(
        '❌ Guild absente.'
      );

      return null;
    }

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (!channel) {
      console.error(
        '❌ Salon sanctions introuvable.'
      );

      return null;
    }

    const requestId =
      `${Date.now()}_${targetUser.id}`;

    const request = {
      id:
        requestId,

      guildId:
        guild.id,

      targetUserId:
        targetUser.id,

      targetTag:
        targetUser.tag,

      proposedSanction:
        proposedSanction,

      finalSanction:
        proposedSanction,

      reason:
        reason,

      source:
        source,

      detectedMessage:
        detectedMessage,

      yesVotes:
        new Set(),

      noVotes:
        new Set(),

      status:
        'pending',

      messageId:
        null
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
          detectedMessage
            .slice(0, 1000)
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
        embeds: [
          embed
        ],

        components: [
          buttons
        ]
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
      '❌ Erreur création demande sanction :',
      error.message
    );

    return null;
  }
}


// ============================================================
// PERMISSIONS
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
        '❌ Tu n’as pas la permission de participer à cette décision.',

      ephemeral:
        true
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
        '❌ Cette demande n’est plus disponible en mémoire.',

      ephemeral:
        true
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

      ephemeral:
        true
    });

    return;
  }

  const voterId =
    interaction.user.id;

  // ----------------------------------------------------------
  // ADMIN
  // ----------------------------------------------------------

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
          ? '👑 Décision administrative : demande validée.'
          : '👑 Décision administrative : demande refusée.',

      ephemeral:
        true
    });

    await finalizeSanctionRequest(
      request
    );

    return;
  }

  // ----------------------------------------------------------
  // DÉJÀ VOTÉ
  // ----------------------------------------------------------

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
        '❌ Tu as déjà voté sur cette demande.',

      ephemeral:
        true
    });

    return;
  }

  // ----------------------------------------------------------
  // ENREGISTRER VOTE
  // ----------------------------------------------------------

  if (vote === 'yes') {
    request.yesVotes.add(
      voterId
    );
  } else {
    request.noVotes.add(
      voterId
    );
  }

  // ----------------------------------------------------------
  // 3 POUR
  // ----------------------------------------------------------

  if (
    request.yesVotes.size >=
    3
  ) {
    request.status =
      'approved';

    await interaction.reply({
      content:
        '🟢 3 votes favorables atteints. La demande est validée.',

      ephemeral:
        true
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
        ? '🟢 Ton vote Pour a été enregistré.'
        : '🔴 Ton vote Contre a été enregistré.',

    ephemeral:
      true
  });
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
            .setDisabled(
              true
            ),

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
            .setDisabled(
              true
            ),

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
            .setDisabled(
              true
            )
        );

    await message.edit({
      embeds: [
        embed
      ],

      components: [
        disabledRow
      ]
    });

    console.log(
      approved
        ? '🟢 Demande validée.'
        : '🔴 Demande refusée.'
    );

  } catch (error) {
    console.error(
      '❌ Erreur finalisation sanction :',
      error.message
    );
  }
}


// ============================================================
// MODIFIER SANCTION
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
        '❌ Tu n’as pas la permission de modifier cette demande.',

      ephemeral:
        true
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

      ephemeral:
        true
    });

    return;
  }

  await interaction.reply({
    content:
      '🟡 La modification de sanction sera ajoutée dans une prochaine étape.',

    ephemeral:
      true
  });
}


// ============================================================
// MISE À JOUR DES VOTES
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

    embed.spliceFields(
      0,
      1,
      {
        name:
          '🗳️ Votes',

        value:
          `🟢 Pour : **${request.yesVotes.size}**\n` +
          `🔴 Contre : **${request.noVotes.size}**\n\n` +
          `Validation automatique à **3 votes Pour**.`
      }
    );

    await message.edit({
      embeds: [
        embed
      ]
    });

  } catch (error) {
    console.error(
      '❌ Erreur mise à jour sanction :',
      error.message
    );
  }
}


// ============================================================
// INTERACTIONS DISCORD
// ============================================================

client.on(
  'interactionCreate',
  async interaction => {

    try {

      // --------------------------------------------------------
      // SLASH COMMAND
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
          !canModerate(interaction) &&
          !isAdmin(interaction)
        ) {
          await interaction.reply({
            content:
              '❌ Cette commande est réservée à la modération.',

            ephemeral:
              true
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

            ephemeral:
              true
          });

          return;
        }

        if (
          target.id ===
          interaction.user.id
        ) {
          await interaction.reply({
            content:
              '❌ Tu ne peux pas créer une demande contre toi-même.',

            ephemeral:
              true
          });

          return;
        }

        const guild =
          interaction.guild;

        if (!guild) {
          await interaction.reply({
            content:
              '❌ Cette commande doit être utilisée sur un serveur.',

            ephemeral:
              true
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

            ephemeral:
              true
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

            ephemeral:
              true
          });

          return;
        }

        await interaction.reply({
          content:
            '✅ Demande de sanction créée dans le salon staff.',

          ephemeral:
            true
        });

        return;
      }

      // --------------------------------------------------------
      // BOUTONS
      // --------------------------------------------------------

      if (
        interaction.isButton()
      ) {

        const parts =
          interaction.customId.split(
            '_'
          );

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

          return;
        }
      }

    } catch (error) {

      console.error(
        '❌ Erreur interaction :',
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

            ephemeral:
              true
          });
        } catch {}
      }
    }
  }
);


// ============================================================
// AUTO-MODÉRATION
// ============================================================

client.on(
  'messageCreate',
  async message => {

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

    // --------------------------------------------------------
    // SENSIBLE
    // --------------------------------------------------------

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
          'Détection automatique d’un contenu potentiellement problématique. Contexte à examiner.',

        source:
          'automatic',

        detectedMessage:
          message.content
      });

      return;
    }

    // --------------------------------------------------------
    // INSULTES GÉNÉRALES
    // --------------------------------------------------------

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
          .setRequired(
            true
          )
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
          .setRequired(
            true
          )
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
            'Explique la raison de la demande.'
          )
          .setRequired(
            true
          )
    );


// ============================================================
// ENREGISTREMENT COMMANDES
// ============================================================

async function registerCommands() {
  if (!DISCORD_TOKEN) {
    console.error(
      '❌ DISCORD_TOKEN absent.'
    );

    return false;
  }

  if (!DISCORD_CLIENT_ID) {
    console.error(
      '❌ DISCORD_CLIENT_ID absent.'
    );

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
      '✅ Commande /sanction enregistrée.'
    );

    return true;

  } catch (error) {
    console.error(
      '❌ Erreur enregistrement commandes :',
      error.message
    );

    return false;
  }
}


// ============================================================
// ÉVÉNEMENT READY
// ============================================================

client.once(
  'clientReady',
  async () => {

    discordReadyAt =
      Date.now();

    lastDiscordReadyAt =
      Date.now();

    console.log(
      '🟢 Nexus est connecté en tant que ' +
      client.user.tag
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
// ÉVÉNEMENTS DISCORD
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
    /*
     * Les événements debug ne doivent PAS
     * être utilisés pour déterminer si
     * Discord est réellement vivant.
     *
     * Ils servent uniquement au diagnostic.
     */
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
      event &&
      event.code
        ? event.code
        : 'inconnu'
    );

    console.error(
      'Raison :',
      event &&
      event.reason
        ? event.reason.toString()
        : 'aucune'
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
// WATCHDOG DISCORD
// ============================================================

const WATCHDOG_INTERVAL =
  30 * 1000;

setInterval(
  () => {

    if (shuttingDown) {
      return;
    }

    try {

      const status =
        client.ws.status;

      const statusName =
        Object.keys(Status).find(
          key =>
            Status[key] ===
            status
        ) ||
        `UNKNOWN(${status})`;

      const ping =
        client.ws.ping;

      const uptime =
        Math.floor(
          process.uptime()
        );

      console.log(
        `[WATCHDOG] Discord=${statusName} | ` +
        `user=${client.user ? client.user.tag : 'non connecté'} | ` +
        `ping=${ping}ms | ` +
        `uptime=${uptime}s`
      );

      /*
       * IMPORTANT :
       *
       * Aucune reconnexion forcée ici.
       *
       * discord.js gère déjà :
       *
       * - heartbeat
       * - reconnexion
       * - resume
       * - reconnexion du shard
       *
       * Le watchdog sert uniquement
       * à afficher l'état réel.
       */

      if (
        status ===
        Status.Ready
      ) {
        return;
      }

      if (
        status ===
        Status.Connecting
      ) {
        console.warn(
          '🟡 Discord est en connexion.'
        );

        return;
      }

      if (
        status ===
        Status.Reconnecting
      ) {
        console.warn(
          '🟠 Discord est en reconnexion.'
        );

        return;
      }

      console.error(
        `🔴 Discord état anormal : ${statusName}`
      );

    } catch (error) {

      console.error(
        '❌ Watchdog Discord :',
        error.message
      );
    }

  },
  WATCHDOG_INTERVAL
);


// ============================================================
// SERVEUR HTTP RENDER
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
        // /
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/'
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
        // /health
        // ------------------------------------------------------

        if (
          url.pathname ===
          '/health'
        ) {

          const discordStatus =
            client.ws.status;

          const healthy =
            discordStatus ===
            Status.Ready;

          const statusName =
            Object.keys(Status).find(
              key =>
                Status[key] ===
                discordStatus
            ) ||
            `UNKNOWN(${discordStatus})`;

          res.writeHead(
            healthy
              ? 200
              : 503,

            {
              'Content-Type':
                'application/json; charset=utf-8'
            }
          );

          res.end(
            JSON.stringify(
              {
                status:
                  healthy
                    ? 'online'
                    : 'degraded',

                discord:
                  statusName,

                ping:
                  client.ws.ping,

                user:
                  client.user
                    ? client.user.tag
                    : null,

                uptime:
                  process.uptime(),

                discordReadyAt:
                  discordReadyAt
                    ? new Date(
                        discordReadyAt
                      ).toISOString()
                    : null,

                twitchEventSub:
                  twitchEventSubSocket &&
                  twitchEventSubSocket.readyState ===
                    WebSocket.OPEN
                    ? 'connected'
                    : 'disconnected',

                shuttingDown:
                  shuttingDown,

                timestamp:
                  new Date().toISOString()
              }
            )
          );

          return;
        }

        // ------------------------------------------------------
        // TWITCH CALLBACK
        // ------------------------------------------------------

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
                '❌ Erreur OAuth Twitch :',
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
                '<h1>Erreur Twitch</h1>'
              );

              return;
            }

            process.env.TWITCH_ACCESS_TOKEN =
              data.access_token;

            if (
              data.refresh_token
            ) {
              process.env.TWITCH_REFRESH_TOKEN =
                data.refresh_token;

              console.warn(
                '⚠️ Nouveau Refresh Token Twitch reçu : sauvegarde-le dans Render.'
              );
            }

            console.log(
              '✅ OAuth Twitch terminé.'
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
              '❌ Erreur OAuth :',
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
              '<h1>Erreur OAuth Twitch</h1>'
            );
          }

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
          '❌ Erreur serveur HTTP :',
          error
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
// SERVEUR
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
    'Initialisation Twitch...'
  );

  const tokenReady =
    await refreshTwitchToken();

  if (!tokenReady) {

    console.error(
      '❌ Impossible d’initialiser Twitch.'
    );

    return;
  }

  const userId =
    await getTwitchUserId(
      TWITCH_USERNAME
    );

  if (!userId) {
    console.error(
      '❌ Impossible de récupérer l’ID Twitch.'
    );

    return;
  }

  console.log(
    `ID Twitch de ${TWITCH_USERNAME}:`,
    userId
  );

  connectTwitchEventSub(
    userId
  );
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
  Boolean(DISCORD_TOKEN)
);

console.log(
  'Discord Client ID présent :',
  Boolean(DISCORD_CLIENT_ID)
);

console.log(
  'Twitch Client ID présent :',
  Boolean(TWITCH_CLIENT_ID)
);

console.log(
  'Twitch Client Secret présent :',
  Boolean(TWITCH_CLIENT_SECRET)
);

console.log(
  'Twitch Access Token présent :',
  Boolean(
    process.env.TWITCH_ACCESS_TOKEN
  )
);

console.log(
  'Twitch Refresh Token présent :',
  Boolean(
    process.env.TWITCH_REFRESH_TOKEN
  )
);

console.log(
  '============================================'
);


// ============================================================
// LOGIN DISCORD
// ============================================================

if (!DISCORD_TOKEN) {

  console.error(
    '❌ Aucun DISCORD_TOKEN configuré.'
  );

} else {

  console.log(
    '🔐 Connexion à Discord...'
  );

  client.login(
    DISCORD_TOKEN
  )
    .then(() => {

      console.log(
        '✅ Login Discord envoyé.'
      );

    })
    .catch(error => {

      console.error(
        '❌ Erreur login Discord :',
        error
      );

      /*
       * IMPORTANT :
       *
       * On ne fait PAS de boucle
       * client.login() ici.
       *
       * discord.js gère les reconnexions
       * du Gateway une fois connecté.
       */
    });
}


// ============================================================
// INITIALISATION TWITCH
// ============================================================

initializeTwitch();


// ============================================================
// HEARTBEAT PROCESSUS
// ============================================================

setInterval(
  () => {

    if (shuttingDown) {
      return;
    }

    console.log(
      `[PROCESS] Nexus actif depuis ${Math.floor(process.uptime())} secondes.`
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
        data.general.length ===
          0 &&
        data.sensitive.length ===
          0
      ) {

        detectionTracker.delete(
          userId
        );
      }
    }

    // --------------------------------------------------------
    // Demandes anciennes
    // --------------------------------------------------------

    /*
     * Les demandes restent actuellement
     * en mémoire jusqu'au redémarrage.
     *
     * On évite simplement que la Map
     * grossisse indéfiniment.
     */

    if (
      sanctionRequests.size >
      500
    ) {

      const requests =
        Array.from(
          sanctionRequests.entries()
        );

      requests
        .slice(
          0,
          100
        )
        .forEach(
          ([id]) =>
            sanctionRequests.delete(
              id
            )
        );

      console.log(
        '🧹 Nettoyage des anciennes demandes de sanction.'
      );
    }

  },
  5 * 60 * 1000
);


// ============================================================
// ERREURS PROCESSUS
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
// ARRÊT PROPRE — SIGTERM
// ============================================================

async function gracefulShutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown =
    true;

  console.warn(
    `🟠 ${signal} reçu. Arrêt propre de Nexus.`
  );

  // ----------------------------------------------------------
  // Twitch
  // ----------------------------------------------------------

  if (twitchReconnectTimer) {
    clearTimeout(
      twitchReconnectTimer
    );

    twitchReconnectTimer =
      null;
  }

  if (
    twitchEventSubSocket
  ) {
    try {
      twitchEventSubSocket.close();
    } catch {}
  }

  // ----------------------------------------------------------
  // Discord
  // ----------------------------------------------------------

  try {
    client.destroy();
  } catch (error) {
    console.error(
      'Erreur fermeture Discord :',
      error.message
    );
  }

  // ----------------------------------------------------------
  // HTTP
  // ----------------------------------------------------------

  try {
    await new Promise(
      resolve => {

        server.close(
          () => {
            resolve();
          }
        );

        setTimeout(
          resolve,
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
