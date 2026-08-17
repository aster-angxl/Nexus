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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder
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
// SYSTÈME DE SANCTIONS
// ========================================

const SANCTION_CHANNEL_ID =
  '1538498193728475197';

const MOD_ROLE_ID =
  '1532562437746851941';

const ADMIN_ROLE_ID =
  '1532566411707289724';

const REQUIRED_MODERATOR_VOTES =
  3;


// ========================================
// PROTECTION ANTI-DOUBLON TWITCH
// ========================================

let lastAnnouncedStreamId = null;


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
// STOCKAGE DES DEMANDES DE SANCTIONS
// ========================================

const sanctionRequests =
  new Map();


// ========================================
// AUTOMOD — CONFIGURATION
// ========================================

// Nombre d'infractions avant timeout
const AUTOMOD_TIMEOUT_INFRACTIONS =
  3;

// Durée du timeout : 10 minutes
const AUTOMOD_TIMEOUT_DURATION =
  10 * 60 * 1000;

// Une infraction expire après 30 minutes
const AUTOMOD_INFRACTION_EXPIRATION =
  30 * 60 * 1000;

// Salon utilisé pour les logs AutoMod
const AUTOMOD_LOG_CHANNEL_ID =
  SANCTION_CHANNEL_ID;

// Nombre maximum de mentions
const AUTOMOD_MAX_MENTIONS =
  5;

// Longueur maximale d'un message
const AUTOMOD_MAX_MESSAGE_LENGTH =
  1000;

// Nombre de messages avant détection du spam
const AUTOMOD_SPAM_LIMIT =
  5;

// Intervalle anti-spam
const AUTOMOD_SPAM_INTERVAL =
  7000;


// ========================================
// AUTOMOD — MOTS INTERDITS
// ========================================
//
// Ajoute ici les mots que tu veux bloquer.
// Exemple :
// 'mot1',
// 'mot2',
//
// Évite de mettre des mots trop courts
// pour ne pas bloquer des mots normaux.
//

const AUTOMOD_BLOCKED_WORDS = [
  'motinterdit1',
  'motinterdit2',
  'motinterdit3'
];


// ========================================
// AUTOMOD — DOMAINES AUTORISÉS
// ========================================

const AUTOMOD_ALLOWED_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'twitch.tv',
  'discord.com',
  'discord.gg'
];


// ========================================
// AUTOMOD — STOCKAGE
// ========================================

const automodInfractions =
  new Map();

const automodMessages =
  new Map();


// ========================================
// COMMANDE SLASH /SANCTION
// ========================================

const sanctionCommand =
  new SlashCommandBuilder()
    .setName('sanction')
    .setDescription(
      'Créer une demande de sanction'
    )
    .addUserOption(
      option =>
        option
          .setName('membre')
          .setDescription(
            'Membre concerné'
          )
          .setRequired(true)
    )
    .addStringOption(
      option =>
        option
          .setName('sanction')
          .setDescription(
            'Sanction proposée'
          )
          .setRequired(true)
          .addChoices(
            {
              name:
                '⚠️ Avertissement',
              value:
                'Avertissement'
            },
            {
              name:
                '⏱️ Timeout',
              value:
                'Timeout'
            },
            {
              name:
                '👢 Kick',
              value:
                'Kick'
            },
            {
              name:
                '🔨 Ban',
              value:
                'Ban'
            }
          )
    )
    .addStringOption(
      option =>
        option
          .setName('raison')
          .setDescription(
            'Raison de la demande'
          )
          .setRequired(true)
    );


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
// TWITCH — RÉCUPÉRER ID UTILISATEUR
// ========================================

async function getTwitchUserId(
  username
) {

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
// TWITCH — PROFIL
// ========================================

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
      'Erreur profil Twitch :',
      error.message
    );

    return null;
  }
}


// ========================================
// TWITCH — LIVE
// ========================================

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
// DISCORD — ALERTE TWITCH
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
        .setColor(0x9146FF)
        .setTitle(
          '🔴 ASTER ANGXL EST EN LIVE !'
        )
        .setURL(
          twitchUrl
        )
        .setDescription(
          'Il vient de lancer un live sur **' +
          gameName +
          '** 🎮\n\n' +
          'Passe lui faire un coucou 👀\n\n' +
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
      embeds:
        [embed]
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
// EVENTSUB — SUBSCRIPTION
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
          method:
            'POST',

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
// EVENTSUB — NOTIFICATION
// ========================================

async function handleEventSubNotification(
  message,
  userId
) {

  const subscription =
    message.payload &&
    message.payload.subscription;

  const event =
    message.payload &&
    message.payload.event;

  if (
    !subscription ||
    subscription.type !==
      'stream.online' ||
    !event
  ) {

    return;
  }

  const streamId =
    event.id;

  console.log(
    'Nouveau live détecté.',
    'Stream ID :',
    streamId
  );

  if (
    lastAnnouncedStreamId ===
    streamId
  ) {

    console.log(
      'Alerte ignorée : ce live a déjà été annoncé.'
    );

    return;
  }

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

  const sent =
    await sendTwitchLiveAnnouncement(
      stream,
      twitchUser
    );

  if (sent) {

    lastAnnouncedStreamId =
      streamId;

    console.log(
      'Live mémorisé pour éviter les doublons.'
    );
  }
}


// ========================================
// EVENTSUB — CONNEXION
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

        if (
          messageType ===
          'session_keepalive'
        ) {

          return;
        }

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
              'Reconnexion EventSub demandée par Twitch.'
            );

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

        if (
          messageType ===
          'revocation'
        ) {

          console.error(
            'Subscription EventSub révoquée.'
          );
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
// SANCTIONS — PERMISSIONS
// ========================================

function getSanctionPermission(
  interaction
) {

  const member =
    interaction.member;

  if (!member) {

    return {
      moderator:
        false,

      admin:
        false
    };
  }

  return {
    moderator:
      member.roles &&
      member.roles.cache.has(
        MOD_ROLE_ID
      ),

    admin:
      member.roles &&
      member.roles.cache.has(
        ADMIN_ROLE_ID
      )
  };
}


// ========================================
// SANCTIONS — EMBED
// ========================================

function buildSanctionEmbed(
  requestId,
  request
) {

  const yesCount =
    request.votesYes.size;

  const noCount =
    request.votesNo.size;

  let color =
    0xF1C40F;

  let title =
    '⚖️ Demande de sanction';

  let description =
    'Une décision de modération est nécessaire.';

  if (
    request.status ===
    'approved'
  ) {

    color =
      0x2ECC71;

    title =
      '🟢 Sanction validée';

    description =
      'La demande de sanction a été validée.';
  }

  if (
    request.status ===
    'rejected'
  ) {

    color =
      0xE74C3C;

    title =
      '🔴 Demande refusée';

    description =
      'La demande de sanction a été refusée.';
  }

  const embed =
    new EmbedBuilder()
      .setColor(
        color
      )
      .setTitle(
        title
      )
      .setDescription(
        description
      )
      .addFields(
        {
          name:
            '👤 Membre',

          value:
            `<@${request.memberId}>`,

          inline:
            false
        },
        {
          name:
            '⚠️ Sanction proposée',

          value:
            request.sanction,

          inline:
            false
        },
        {
          name:
            '📝 Raison',

          value:
            request.reason,

          inline:
            false
        },
        {
          name:
            '📎 Source',

          value:
            request.source,

          inline:
            false
        },
        {
          name:
            '🗳️ Votes',

          value:
            `🟢 Pour : **${yesCount} / ${REQUIRED_MODERATOR_VOTES}**\n` +
            `🔴 Contre : **${noCount} / ${REQUIRED_MODERATOR_VOTES}**`,

          inline:
            false
        }
      );

  if (
    request.modifiedBy
  ) {

    embed.addFields({
      name:
        '🔄 Dernière modification',

      value:
        `<@${request.modifiedBy}> a modifié la sanction proposée.\n` +
        `**Raison :** ${request.modificationReason || 'Non renseignée'}`,

      inline:
        false
    });
  }

  if (
    request.decidedBy
  ) {

    const decisionLabel =
      request.decisionType === 'admin'
        ? '👑 Administrateur'
        : '🛡️ Vote de la modération';

    embed.addFields({
      name:
        '⚖️ Décision',

      value:
        `${decisionLabel}\nDécision par : <@${request.decidedBy}>`,

      inline:
        false
    });
  }

  embed.setFooter({
    text:
      `Nexus • Demande ${requestId}`
  });

  embed.setTimestamp();

  return embed;
}


// ========================================
// SANCTIONS — BOUTONS
// ========================================

function buildSanctionButtons(
  requestId,
  disabled = false
) {

  const yesButton =
    new ButtonBuilder()
      .setCustomId(
        `sanction_yes:${requestId}`
      )
      .setLabel(
        'Valider'
      )
      .setEmoji(
        '🟢'
      )
      .setStyle(
        ButtonStyle.Success
      )
      .setDisabled(
        disabled
      );

  const noButton =
    new ButtonBuilder()
      .setCustomId(
        `sanction_no:${requestId}`
      )
      .setLabel(
        'Refuser'
      )
      .setEmoji(
        '🔴'
      )
      .setStyle(
        ButtonStyle.Danger
      )
      .setDisabled(
        disabled
      );

  const modifyButton =
    new ButtonBuilder()
      .setCustomId(
        `sanction_modify:${requestId}`
      )
      .setLabel(
        'Modifier la sanction'
      )
      .setEmoji(
        '🟡'
      )
      .setStyle(
        ButtonStyle.Secondary
      )
      .setDisabled(
        disabled
      );

  return new ActionRowBuilder()
    .addComponents(
      yesButton,
      noButton,
      modifyButton
    );
}


// ========================================
// SANCTIONS — METTRE À JOUR LE MESSAGE
// ========================================

async function updateSanctionMessage(
  requestId
) {

  const request =
    sanctionRequests.get(
      requestId
    );

  if (!request) {
    return false;
  }

  if (!request.messageId) {

    console.error(
      'Message ID absent pour la demande :',
      requestId
    );

    return false;
  }

  try {

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (!channel) {

      console.error(
        'Salon de sanction introuvable.'
      );

      return false;
    }

    const message =
      await channel.messages.fetch(
        request.messageId
      );

    if (!message) {

      console.error(
        'Message de sanction introuvable.'
      );

      return false;
    }

    const embed =
      buildSanctionEmbed(
        requestId,
        request
      );

    const components =
      request.status === 'pending'
        ? [
            buildSanctionButtons(
              requestId,
              false
            )
          ]
        : [
            buildSanctionButtons(
              requestId,
              true
            )
          ];

    await message.edit({
      embeds:
        [embed],

      components:
        components
    });

    return true;

  } catch (error) {

    console.error(
      'Erreur mise à jour message sanction :',
      error.message
    );

    return false;
  }
}


// ========================================
// SANCTIONS — CRÉER UNE DEMANDE
// ========================================

async function createSanctionRequest({
  memberId,
  sanction,
  reason,
  source,
  createdBy
}) {

  try {

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (!channel) {

      console.error(
        'Salon des demandes de sanctions introuvable.'
      );

      return null;
    }

    const requestId =
      `${Date.now()}-${memberId}`;

    const request = {

      memberId:
        memberId,

      sanction:
        sanction,

      reason:
        reason,

      source:
        source ||
        'Non renseignée',

      createdBy:
        createdBy,

      votesYes:
        new Set(),

      votesNo:
        new Set(),

      modifiedBy:
        null,

      modificationReason:
        null,

      decidedBy:
        null,

      decisionType:
        null,

      status:
        'pending',

      messageId:
        null
    };

    sanctionRequests.set(
      requestId,
      request
    );

    const embed =
      buildSanctionEmbed(
        requestId,
        request
      );

    const buttons =
      buildSanctionButtons(
        requestId
      );

    const message =
      await channel.send({
        embeds:
          [embed],

        components:
          [buttons]
      });

    request.messageId =
      message.id;

    console.log(
      'Demande de sanction créée :',
      requestId
    );

    return requestId;

  } catch (error) {

    console.error(
      'Erreur création demande sanction :',
      error.message
    );

    return null;
  }
}


// ========================================
// AUTOMOD — EXEMPTIONS
// ========================================

function isAutoModExempt(
  member
) {

  if (!member) {
    return false;
  }

  // Bots ignorés
  if (member.user.bot) {
    return true;
  }

  // Modérateurs protégés
  if (
    member.roles &&
    member.roles.cache.has(
      MOD_ROLE_ID
    )
  ) {
    return true;
  }

  // Administrateurs protégés
  if (
    member.roles &&
    member.roles.cache.has(
      ADMIN_ROLE_ID
    )
  ) {
    return true;
  }

  return false;
}


// ========================================
// AUTOMOD — INFRACTION
// ========================================

function addAutoModInfraction(
  userId
) {

  const now =
    Date.now();

  const current =
    automodInfractions.get(
      userId
    );

  if (
    !current ||
    now -
      current.lastInfraction >
    AUTOMOD_INFRACTION_EXPIRATION
  ) {

    automodInfractions.set(
      userId,
      {
        count:
          1,

        lastInfraction:
          now
      }
    );

    return 1;
  }

  current.count += 1;

  current.lastInfraction =
    now;

  return current.count;
}


// ========================================
// AUTOMOD — LOG
// ========================================

async function sendAutoModLog(
  message,
  reason,
  infractionCount
) {

  try {

    const channel =
      await client.channels.fetch(
        AUTOMOD_LOG_CHANNEL_ID
      );

    if (!channel) {
      return;
    }

    const embed =
      new EmbedBuilder()
        .setColor(
          0xE74C3C
        )
        .setTitle(
          '🛡️ AutoMod — Infraction'
        )
        .addFields(
          {
            name:
              '👤 Membre',

            value:
              `<@${message.author.id}>`,

            inline:
              true
          },
          {
            name:
              '⚠️ Motif',

            value:
              reason,

            inline:
              true
          },
          {
            name:
              '📊 Infractions',

            value:
              `${infractionCount} / ${AUTOMOD_TIMEOUT_INFRACTIONS}`,

            inline:
              true
          },
          {
            name:
              '💬 Message',

            value:
              message.content
                ? message.content.slice(0, 1000)
                : 'Message non disponible',

            inline:
              false
          }
        )
        .setTimestamp();

    await channel.send({
      embeds:
        [embed]
    });

  } catch (error) {

    console.error(
      'Erreur log AutoMod :',
      error.message
    );
  }
}


// ========================================
// AUTOMOD — AVERTISSEMENT
// ========================================

async function sendAutoModWarning(
  message,
  reason,
  infractionCount
) {

  try {

    const warning =
      await message.channel.send({
        content:
          `⚠️ <@${message.author.id}>, ton message a été supprimé.\n` +
          `**Raison :** ${reason}\n` +
          `**Infractions :** ${infractionCount}/${AUTOMOD_TIMEOUT_INFRACTIONS}`
      });

    setTimeout(
      async function () {

        try {

          await warning.delete();

        } catch {
          // Le message a déjà été supprimé.
        }

      },
      7000
    );

  } catch (error) {

    console.error(
      'Erreur avertissement AutoMod :',
      error.message
    );
  }
}


// ========================================
// AUTOMOD — TIMEOUT
// ========================================

async function applyAutoModTimeout(
  message
) {

  try {

    const member =
      message.member;

    if (!member) {
      return false;
    }

    if (!member.moderatable) {

      console.error(
        'AutoMod ne peut pas timeout :',
        message.author.tag
      );

      return false;
    }

    await member.timeout(
      AUTOMOD_TIMEOUT_DURATION,
      'AutoMod : accumulation de trois infractions'
    );

    try {

      await message.channel.send({
        content:
          `🔨 <@${message.author.id}> a reçu un **timeout de 10 minutes** ` +
          `pour accumulation de trois infractions AutoMod.`
      });

    } catch {
      // Rien à faire.
    }

    return true;

  } catch (error) {

    console.error(
      'Erreur timeout AutoMod :',
      error.message
    );

    return false;
  }
}


// ========================================
// AUTOMOD — MOTS INTERDITS
// ========================================

function containsBlockedWord(
  content
) {

  const normalized =
    content
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      );

  for (
    const word
    of AUTOMOD_BLOCKED_WORDS
  ) {

    const normalizedWord =
      word
        .toLowerCase()
        .normalize('NFD')
        .replace(
          /[\u0300-\u036f]/g,
          ''
        );

    if (
      normalized.includes(
        normalizedWord
      )
    ) {

      return true;
    }
  }

  return false;
}


// ========================================
// AUTOMOD — LIENS
// ========================================

function containsForbiddenLink(
  content
) {

  const urlRegex =
    /(https?:\/\/[^\s]+)/gi;

  const urls =
    content.match(
      urlRegex
    );

  if (!urls) {
    return false;
  }

  for (
    const url
    of urls
  ) {

    try {

      const parsed =
        new URL(
          url
        );

      const hostname =
        parsed.hostname
          .toLowerCase()
          .replace(
            /^www\./,
            ''
          );

      const allowed =
        AUTOMOD_ALLOWED_DOMAINS.some(
          domain =>
            hostname === domain ||
            hostname.endsWith(
              `.${domain}`
            )
        );

      if (!allowed) {
        return true;
      }

    } catch {

      return true;
    }
  }

  return false;
}


// ========================================
// AUTOMOD — MAJUSCULES
// ========================================

function isExcessiveCaps(
  content
) {

  const letters =
    content.match(
      /[a-zA-ZÀ-ÿ]/g
    );

  if (
    !letters ||
    letters.length < 10
  ) {
    return false;
  }

  const uppercase =
    content.match(
      /[A-ZÀ-Ý]/g
    );

  if (!uppercase) {
    return false;
  }

  return (
    uppercase.length /
      letters.length >=
    0.75
  );
}


// ========================================
// AUTOMOD — MENTIONS
// ========================================

function hasTooManyMentions(
  message
) {

  const userMentions =
    message.mentions.users.size;

  const roleMentions =
    message.mentions.roles.size;

  return (
    userMentions +
      roleMentions >
    AUTOMOD_MAX_MENTIONS
  );
}


// ========================================
// AUTOMOD — SPAM
// ========================================

function isSpam(
  message
) {

  const userId =
    message.author.id;

  const now =
    Date.now();

  let data =
    automodMessages.get(
      userId
    );

  if (!data) {

    data = [];

    automodMessages.set(
      userId,
      data
    );
  }

  data.push({
    content:
      message.content,

    timestamp:
      now
  });

  const recent =
    data.filter(
      entry =>
        now -
          entry.timestamp <=
        AUTOMOD_SPAM_INTERVAL
    );

  automodMessages.set(
    userId,
    recent
  );

  return (
    recent.length >=
    AUTOMOD_SPAM_LIMIT
  );
}


// ========================================
// AUTOMOD — MESSAGE RÉPÉTÉ
// ========================================

function isRepeatedMessage(
  message
) {

  const userId =
    message.author.id;

  const data =
    automodMessages.get(
      userId
    );

  if (
    !data ||
    data.length < 3
  ) {
    return false;
  }

  const recent =
    data.slice(-3);

  return (
    recent.length === 3 &&
    recent.every(
      entry =>
        entry.content ===
        message.content
    )
  );
}


// ========================================
// AUTOMOD — MESSAGE CREATE
// ========================================

client.on(
  'messageCreate',
  async function (
    message
  ) {

    try {

      // Ignorer les bots
      if (
        message.author.bot
      ) {
        return;
      }

      // Vérifier le membre
      const member =
        message.member;

      // Modérateurs/admins protégés
      if (
        isAutoModExempt(
          member
        )
      ) {
        return;
      }

      const content =
        message.content || '';

      let reason =
        null;


      // ==================================
      // MESSAGE TROP LONG
      // ==================================

      if (
        content.length >
        AUTOMOD_MAX_MESSAGE_LENGTH
      ) {

        reason =
          'Message trop long';
      }


      // ==================================
      // MOT INTERDIT
      // ==================================

      if (
        !reason &&
        containsBlockedWord(
          content
        )
      ) {

        reason =
          'Mot ou expression interdite';
      }


      // ==================================
      // LIEN INTERDIT
      // ==================================

      if (
        !reason &&
        containsForbiddenLink(
          content
        )
      ) {

        reason =
          'Lien non autorisé';
      }


      // ==================================
      // TROP DE MENTIONS
      // ==================================

      if (
        !reason &&
        hasTooManyMentions(
          message
        )
      ) {

        reason =
          'Trop de mentions';
      }


      // ==================================
      // MAJUSCULES
      // ==================================

      if (
        !reason &&
        isExcessiveCaps(
          content
        )
      ) {

        reason =
          'Utilisation excessive des majuscules';
      }


      // ==================================
      // SPAM
      // ==================================

      const spamDetected =
        isSpam(
          message
        );

      if (
        !reason &&
        spamDetected
      ) {

        reason =
          'Spam détecté';
      }


      // ==================================
      // MESSAGES RÉPÉTÉS
      // ==================================

      if (
        !reason &&
        isRepeatedMessage(
          message
        )
      ) {

        reason =
          'Messages répétitifs';
      }


      // ==================================
      // MESSAGE NORMAL
      // ==================================

      if (!reason) {
        return;
      }


      // ==================================
      // SUPPRESSION
      // ==================================

      try {

        await message.delete();

      } catch (error) {

        console.error(
          'AutoMod ne peut pas supprimer le message :',
          error.message
        );
      }


      // ==================================
      // AJOUT INFRACTION
      // ==================================

      const infractionCount =
        addAutoModInfraction(
          message.author.id
        );


      // ==================================
      // LOG
      // ==================================

      await sendAutoModLog(
        message,
        reason,
        infractionCount
      );


      // ==================================
      // TIMEOUT APRÈS 3 INFRACTIONS
      // ==================================

      if (
        infractionCount >=
        AUTOMOD_TIMEOUT_INFRACTIONS
      ) {

        const timedOut =
          await applyAutoModTimeout(
            message
          );

        if (timedOut) {

          automodInfractions.delete(
            message.author.id
          );
        }

        return;
      }


      // ==================================
      // AVERTISSEMENT
      // ==================================

      await sendAutoModWarning(
        message,
        reason,
        infractionCount
      );

    } catch (error) {

      console.error(
        'Erreur AutoMod :',
        error
      );
    }
  }
);


// ========================================
// AUTOMOD — NETTOYAGE
// ========================================

setInterval(
  function () {

    const now =
      Date.now();


    // Nettoyage des infractions
    for (
      const [
        userId,
        data
      ]
      of automodInfractions
    ) {

      if (
        now -
          data.lastInfraction >
        AUTOMOD_INFRACTION_EXPIRATION
      ) {

        automodInfractions.delete(
          userId
        );
      }
    }


    // Nettoyage anti-spam
    for (
      const [
        userId,
        messages
      ]
      of automodMessages
    ) {

      const recent =
        messages.filter(
          entry =>
            now -
              entry.timestamp <=
            AUTOMOD_SPAM_INTERVAL
        );

      if (
        recent.length === 0
      ) {

        automodMessages.delete(
          userId
        );

      } else {

        automodMessages.set(
          userId,
          recent
        );
      }
    }

  },
  60 * 1000
);


// ========================================
// DISCORD — INTERACTIONS
// ========================================

client.on(
  'interactionCreate',
  async function (
    interaction
  ) {

    try {

      // ==================================
      // COMMANDE /SANCTION
      // ==================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          'sanction'
      ) {

        const permissions =
          getSanctionPermission(
            interaction
          );

        if (
          !permissions.moderator &&
          !permissions.admin
        ) {

          await interaction.reply({
            content:
              '❌ Tu n’as pas la permission d’utiliser cette commande.',

            ephemeral:
              true
          });

          return;
        }

        const targetMember =
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

        const requestId =
          await createSanctionRequest({
            memberId:
              targetMember.id,

            sanction:
              sanction,

            reason:
              reason,

            source:
              'Demande manuelle par un modérateur',

            createdBy:
              interaction.user.id
          });

        if (!requestId) {

          await interaction.reply({
            content:
              '❌ Impossible de créer la demande de sanction.',

            ephemeral:
              true
          });

          return;
        }

        await interaction.reply({
          content:
            '✅ Demande de sanction créée dans le salon de modération.',

          ephemeral:
            true
        });

        return;
      }


      // ==================================
      // UNIQUEMENT BOUTONS / MODALS
      // ==================================

      if (
        !interaction.isButton() &&
        !interaction.isModalSubmit()
      ) {

        return;
      }


      // ==================================
      // VÉRIFICATION DU SALON
      // ==================================

      if (
        interaction.channelId !==
        SANCTION_CHANNEL_ID
      ) {

        return;
      }


      // ==================================
      // PERMISSIONS
      // ==================================

      const permissions =
        getSanctionPermission(
          interaction
        );

      if (
        !permissions.moderator &&
        !permissions.admin
      ) {

        await interaction.reply({
          content:
            '❌ Tu n’as pas la permission d’utiliser ce système.',

          ephemeral:
            true
        });

        return;
      }


      // ==================================
      // MODIFIER LA SANCTION
      // ==================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'sanction_modify:'
        )
      ) {

        const requestId =
          interaction.customId.split(':')[1];

        const request =
          sanctionRequests.get(
            requestId
          );

        if (!request) {

          await interaction.reply({
            content:
              '❌ Cette demande n’existe plus.',

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

        const modal =
          new ModalBuilder()
            .setCustomId(
              `sanction_modify_modal:${requestId}`
            )
            .setTitle(
              'Modifier la sanction'
            );

        const sanctionInput =
          new TextInputBuilder()
            .setCustomId(
              'new_sanction'
            )
            .setLabel(
              'Nouvelle sanction'
            )
            .setPlaceholder(
              'Exemple : Timeout 1 heure'
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(
              true
            );

        const reasonInput =
          new TextInputBuilder()
            .setCustomId(
              'modification_reason'
            )
            .setLabel(
              'Pourquoi la modifier ?'
            )
            .setPlaceholder(
              'Explique brièvement ton choix.'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(
              true
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

        return;
      }


      // ==================================
      // MODAL DE MODIFICATION
      // ==================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'sanction_modify_modal:'
        )
      ) {

        const requestId =
          interaction.customId.split(':')[1];

        const request =
          sanctionRequests.get(
            requestId
          );

        if (!request) {

          await interaction.reply({
            content:
              '❌ Cette demande n’existe plus.',

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

        const newSanction =
          interaction.fields.getTextInputValue(
            'new_sanction'
          );

        const modificationReason =
          interaction.fields.getTextInputValue(
            'modification_reason'
          );

        request.sanction =
          newSanction;

        request.modifiedBy =
          interaction.user.id;

        request.modificationReason =
          modificationReason;

        // Réinitialisation des votes
        request.votesYes.clear();
        request.votesNo.clear();

        await updateSanctionMessage(
          requestId
        );

        await interaction.reply({
          content:
            '🟡 La sanction proposée a été modifiée. Les votes précédents ont été réinitialisés.',

          ephemeral:
            true
        });

        return;
      }


      // ==================================
      // VOTE POUR
      // ==================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'sanction_yes:'
        )
      ) {

        const requestId =
          interaction.customId.split(':')[1];

        const request =
          sanctionRequests.get(
            requestId
          );

        if (!request) {

          await interaction.reply({
            content:
              '❌ Cette demande n’existe plus.',

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

        const userId =
          interaction.user.id;


        // ==================================
        // ADMIN
        // ==================================

        if (
          permissions.admin
        ) {

          request.status =
            'approved';

          request.decidedBy =
            userId;

          request.decisionType =
            'admin';

          await updateSanctionMessage(
            requestId
          );

          await interaction.reply({
            content:
              '👑 La sanction a été validée directement par l’administrateur.',

            ephemeral:
              false
          });

          return;
        }


        // ==================================
        // MODÉRATEUR
        // ==================================

        request.votesNo.delete(
          userId
        );

        request.votesYes.add(
          userId
        );

        const yesCount =
          request.votesYes.size;


        // ==================================
        // 3 VOTES POUR
        // ==================================

        if (
          yesCount >=
          REQUIRED_MODERATOR_VOTES
        ) {

          request.status =
            'approved';

          request.decidedBy =
            userId;

          request.decisionType =
            'moderator_vote';

          await updateSanctionMessage(
            requestId
          );

          await interaction.reply({
            content:
              '🟢 3 modérateurs ont validé la sanction. La demande est acceptée.',

            ephemeral:
              false
          });

          return;
        }


        // ==================================
        // PAS ENCORE 3 VOTES
        // ==================================

        await updateSanctionMessage(
          requestId
        );

        await interaction.reply({
          content:
            `🟢 Ton vote a été enregistré. ${yesCount}/${REQUIRED_MODERATOR_VOTES} votes pour nécessaires.`,

          ephemeral:
            true
        });

        return;
      }


      // ==================================
      // VOTE CONTRE
      // ==================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'sanction_no:'
        )
      ) {

        const requestId =
          interaction.customId.split(':')[1];

        const request =
          sanctionRequests.get(
            requestId
          );

        if (!request) {

          await interaction.reply({
            content:
              '❌ Cette demande n’existe plus.',

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

        const userId =
          interaction.user.id;


        // ==================================
        // ADMIN
        // ==================================

        if (
          permissions.admin
        ) {

          request.status =
            'rejected';

          request.decidedBy =
            userId;

          request.decisionType =
            'admin';

          await updateSanctionMessage(
            requestId
          );

          await interaction.reply({
            content:
              '👑 La demande de sanction a été refusée directement par l’administrateur.',

            ephemeral:
              false
          });

          return;
        }


        // ==================================
        // MODÉRATEUR
        // ==================================

        request.votesYes.delete(
          userId
        );

        request.votesNo.add(
          userId
        );

        const noCount =
          request.votesNo.size;


        // ==================================
        // 3 VOTES CONTRE
        // ==================================

        if (
          noCount >=
          REQUIRED_MODERATOR_VOTES
        ) {

          request.status =
            'rejected';

          request.decidedBy =
            userId;

          request.decisionType =
            'moderator_vote';

          await updateSanctionMessage(
            requestId
          );

          await interaction.reply({
            content:
              '🔴 3 modérateurs ont refusé la sanction. La demande est rejetée.',

            ephemeral:
              false
          });

          return;
        }


        // ==================================
        // PAS ENCORE 3 VOTES
        // ==================================

        await updateSanctionMessage(
          requestId
        );

        await interaction.reply({
          content:
            `🔴 Ton vote a été enregistré. ${noCount}/${REQUIRED_MODERATOR_VOTES} votes contre nécessaires.`,

          ephemeral:
            true
        });

        return;
      }

    } catch (error) {

      console.error(
        'Erreur interaction sanction :',
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

        } catch (replyError) {

          console.error(
            'Impossible de répondre à l’interaction :',
            replyError.message
          );
        }
      }
    }
  }
);


// ========================================
// ENREGISTREMENT DES COMMANDES SLASH
// ========================================

async function registerSlashCommands() {

  try {

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (
      !channel ||
      !channel.guild
    ) {

      console.error(
        'Impossible de trouver le serveur pour enregistrer /sanction.'
      );

      return;
    }

    const guildId =
      channel.guild.id;

    const rest =
      new REST({
        version:
          '10'
      }).setToken(
        process.env.DISCORD_TOKEN
      );

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        guildId
      ),
      {
        body: [
          sanctionCommand.toJSON()
        ]
      }
    );

    console.log(
      'Commande /sanction enregistrée avec succès.'
    );

  } catch (error) {

    console.error(
      'Erreur enregistrement commande /sanction :',
      error
    );
  }
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


      // ==================================
      // PAGE PRINCIPALE
      // ==================================

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


      // ==================================
      // CALLBACK TWITCH
      // ==================================

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


        // ==================================
        // REFUS
        // ==================================

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


        // ==================================
        // CODE ABSENT
        // ==================================

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

          if (
            !tokenResponse.ok
          ) {

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

            console.log(
              'Nouveau Refresh Token Twitch reçu.'
            );
          }

          console.log(
            'Access Token Twitch obtenu.'
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


      // ==================================
      // 404
      // ==================================

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
// DÉMARRAGE SERVEUR HTTP
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
      'Impossible d’initialiser Twitch.'
    );

    return;
  }

  const userId =
    await getTwitchUserId(
      TWITCH_USERNAME
    );

  if (!userId) {

    console.error(
      'Impossible de récupérer l’ID Twitch.'
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
  async function () {

    console.log(
      'Nexus est connecté en tant que ' +
      client.user.tag
    );

    console.log(
      'AutoMod activé.'
    );

    await registerSlashCommands();
  }
);


// ========================================
// ERREURS DISCORD
// ========================================

client.on(
  'error',
  function (
    error
  ) {

    console.error(
      'Erreur Discord :',
      error
    );
  }
);


client.on(
  'warn',
  function (
    message
  ) {

    console.warn(
      '[WARN]',
      message
    );
  }
);


// ========================================
// DEBUG
// ========================================

client.on(
  'debug',
  function (
    message
  ) {

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
  function (
    id
  ) {

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
  function (
    id
  ) {

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
  function (
    error
  ) {

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
