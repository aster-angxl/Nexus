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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  REST,
  Routes
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

// Salon des demandes de sanctions
const SANCTION_CHANNEL_ID =
  '1538498193728475197';

// Rôle modérateur
const MODERATOR_ROLE_ID =
  '1532562437746851941';

// Rôle administrateur
const ADMIN_ROLE_ID =
  '1532566411707289724';


// ========================================
// PROTECTION ANTI-DOUBLON TWITCH
// ========================================

let lastAnnouncedStreamId = null;


// ========================================
// DEMANDES DE SANCTIONS
// ========================================

// Stockage temporaire en mémoire.
// Plus tard, on pourra mettre une vraie base de données.
const sanctionRequests = new Map();

let nextSanctionRequestId = 1;


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
// OUTILS PERMISSIONS
// ========================================

function isModerator(member) {

  if (!member) {
    return false;
  }

  return (
    member.roles.cache.has(
      MODERATOR_ROLE_ID
    ) ||
    member.roles.cache.has(
      ADMIN_ROLE_ID
    )
  );
}


function isAdmin(member) {

  if (!member) {
    return false;
  }

  return member.roles.cache.has(
    ADMIN_ROLE_ID
  );
}


// ========================================
// SANCTIONS DISPONIBLES
// ========================================

const SANCTION_LABELS = {

  warning:
    '⚠️ Avertissement',

  timeout_10m:
    '🔇 Timeout — 10 minutes',

  timeout_1h:
    '🔇 Timeout — 1 heure',

  timeout_24h:
    '🔇 Timeout — 24 heures',

  kick:
    '👢 Kick',

  ban:
    '🔨 Ban'

};


function getSanctionLabel(type) {

  return (
    SANCTION_LABELS[type] ||
    'Sanction inconnue'
  );

}


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
// TWITCH — RÉCUPÉRER ID UTILISATEUR
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
// TWITCH — PROFIL
// ========================================

async function getTwitchUser(userId) {

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

async function getTwitchStream(userId) {

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

        .setColor(
          0x9146FF
        )

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

          '👉 **[Regarder le live](' +
          twitchUrl +
          ')**'

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
// SANCTIONS — FORMATAGE VOTES
// ========================================

function countVotes(request) {

  return {
    pour:
      request.votesPour.size,

    contre:
      request.votesContre.size
  };

}


// ========================================
// SANCTIONS — CRÉER LES BOUTONS
// ========================================

function createSanctionButtons(
  request,
  disabled = false
) {

  const buttons =
    new ActionRowBuilder()

      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            `sanction_pour_${request.id}`
          )

          .setLabel(
            'Pour'
          )

          .setEmoji(
            '🟢'
          )

          .setStyle(
            ButtonStyle.Success
          )

          .setDisabled(
            disabled
          ),


        new ButtonBuilder()

          .setCustomId(
            `sanction_contre_${request.id}`
          )

          .setLabel(
            'Contre'
          )

          .setEmoji(
            '🔴'
          )

          .setStyle(
            ButtonStyle.Danger
          )

          .setDisabled(
            disabled
          ),


        new ButtonBuilder()

          .setCustomId(
            `sanction_modifier_${request.id}`
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
          )

      );

  return [
    buttons
  ];

}


// ========================================
// SANCTIONS — EMBED
// ========================================

function createSanctionEmbed(
  request
) {

  const votes =
    countVotes(
      request
    );

  const decisionText =
    request.status === 'pending'
      ? '🟡 En attente'
      : request.status === 'approved'
        ? '🟢 Sanction validée'
        : '🔴 Demande refusée';


  const sourceText =
    request.source === 'automatic'
      ? '🤖 Détection automatique'
      : `👮 ${request.requestedByTag}`;


  return new EmbedBuilder()

    .setColor(
      request.status === 'pending'
        ? 0xF1C40F
        : request.status === 'approved'
          ? 0x2ECC71
          : 0xE74C3C
    )

    .setTitle(
      '🚨 Demande de sanction'
    )

    .addFields(

      {
        name:
          '👤 Membre',

        value:
          `<@${request.targetId}>`,

        inline:
          true
      },

      {
        name:
          '⚠️ Sanction proposée',

        value:
          getSanctionLabel(
            request.sanction
          ),

        inline:
          true
      },

      {
        name:
          '🔎 Source',

        value:
          sourceText,

        inline:
          true
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
          '🗳️ Votes',

        value:
          `🟢 Pour : **${votes.pour}**\n` +
          `🔴 Contre : **${votes.contre}**\n` +
          `🎯 Objectif : **3 votes Pour**`,

        inline:
          false
      },

      {
        name:
          '📊 Décision',

        value:
          decisionText,

        inline:
          false
      }

    )

    .setFooter({

      text:
        `Demande #${request.id}`

    })

    .setTimestamp();

}


// ========================================
// SANCTIONS — METTRE À JOUR LE MESSAGE
// ========================================

async function updateSanctionMessage(
  request,
  disabled = false
) {

  try {

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );

    if (!channel) {
      return;
    }

    const message =
      await channel.messages.fetch(
        request.messageId
      );

    await message.edit({

      embeds: [
        createSanctionEmbed(
          request
        )
      ],

      components:
        createSanctionButtons(
          request,
          disabled
        )

    });

  } catch (error) {

    console.error(
      'Erreur mise à jour demande sanction :',
      error.message
    );

  }

}


// ========================================
// SANCTIONS — CRÉER UNE DEMANDE
// ========================================

async function createSanctionRequest({

  guild,
  target,
  sanction,
  reason,
  source,
  requestedBy

}) {

  const channel =
    await guild.channels.fetch(
      SANCTION_CHANNEL_ID
    );


  if (!channel) {

    throw new Error(
      'Salon des demandes de sanctions introuvable.'
    );

  }


  const request = {

    id:
      String(
        nextSanctionRequestId++
      ),

    guildId:
      guild.id,

    targetId:
      target.id,

    targetTag:
      target.user.tag,

    sanction:
      sanction,

    reason:
      reason,

    source:
      source,

    requestedById:
      requestedBy.id,

    requestedByTag:
      requestedBy.user.tag,

    votesPour:
      new Set(),

    votesContre:
      new Set(),

    status:
      'pending',

    messageId:
      null,

    createdAt:
      Date.now()

  };


  const message =
    await channel.send({

      embeds: [
        createSanctionEmbed(
          request
        )
      ],

      components:
        createSanctionButtons(
          request
        )

    });


  request.messageId =
    message.id;


  sanctionRequests.set(
    request.id,
    request
  );


  console.log(
    'Demande de sanction créée :',
    request.id
  );


  return request;

}


// ========================================
// SANCTIONS — DÉCISION
// ========================================

async function approveSanction(
  request,
  interaction,
  reason
) {

  request.status =
    'approved';

  request.decisionBy =
    interaction.user.id;

  request.decisionByTag =
    interaction.user.tag;

  request.decisionReason =
    reason || null;

  request.decidedAt =
    Date.now();


  await updateSanctionMessage(
    request,
    true
  );


  console.log(
    'Demande de sanction validée :',
    request.id
  );

}


// ========================================
// SANCTIONS — REFUS
// ========================================

async function rejectSanction(
  request,
  interaction,
  reason
) {

  request.status =
    'rejected';

  request.decisionBy =
    interaction.user.id;

  request.decisionByTag =
    interaction.user.tag;

  request.decisionReason =
    reason || null;

  request.decidedAt =
    Date.now();


  await updateSanctionMessage(
    request,
    true
  );


  console.log(
    'Demande de sanction refusée :',
    request.id
  );

}


// ========================================
// SANCTIONS — INTERACTIONS
// ========================================

client.on(
  'interactionCreate',
  async function (
    interaction
  ) {

    try {

      // ==================================
      // SLASH COMMAND
      // ==================================

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
          !interaction.guild
        ) {

          await interaction.reply({

            content:
              '❌ Cette commande doit être utilisée sur le serveur.',

            ephemeral:
              true

          });

          return;
        }


        if (
          !isModerator(
            interaction.member
          )
        ) {

          await interaction.reply({

            content:
              '❌ Tu n’as pas la permission d’utiliser cette commande.',

            ephemeral:
              true

          });

          return;
        }


        const target =
          interaction.options.getMember(
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
          target.user.bot
        ) {

          await interaction.reply({

            content:
              '❌ Tu ne peux pas créer une demande de sanction pour un bot.',

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
              '❌ Tu ne peux pas créer une demande de sanction contre toi-même.',

            ephemeral:
              true

          });

          return;
        }


        const request =
          await createSanctionRequest({

            guild:
              interaction.guild,

            target:
              target,

            sanction:
              sanction,

            reason:
              reason,

            source:
              'manual',

            requestedBy:
              interaction.member

          });


        await interaction.reply({

          content:
            `✅ Demande de sanction **#${request.id}** créée dans <#${SANCTION_CHANNEL_ID}>.`,

          ephemeral:
            true

        });

        return;
      }


      // ==================================
      // BOUTONS
      // ==================================

      if (
        interaction.isButton()
      ) {

        const parts =
          interaction.customId.split(
            '_'
          );

        if (
          parts[0] !==
          'sanction'
        ) {

          return;
        }


        const action =
          parts[1];

        const requestId =
          parts.slice(2).join(
            '_'
          );


        const request =
          sanctionRequests.get(
            requestId
          );


        if (!request) {

          await interaction.reply({

            content:
              '❌ Cette demande n’est plus disponible. Elle a probablement été perdue après un redémarrage du bot.',

            ephemeral:
              true

          });

          return;
        }


        if (
          !isModerator(
            interaction.member
          )
        ) {

          await interaction.reply({

            content:
              '❌ Seuls les modérateurs peuvent voter.',

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
              '❌ Cette demande a déjà été traitée.',

            ephemeral:
              true

          });

          return;
        }


        // ================================
        // MODIFIER
        // ================================

        if (
          action ===
          'modifier'
        ) {

          const menu =
            new StringSelectMenuBuilder()

              .setCustomId(
                `sanction_change_${request.id}`
              )

              .setPlaceholder(
                'Choisir la nouvelle sanction'
              )

              .addOptions(

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Avertissement'
                  )

                  .setDescription(
                    'Avertissement officiel'
                  )

                  .setEmoji(
                    '⚠️'
                  )

                  .setValue(
                    'warning'
                  ),

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Timeout — 10 minutes'
                  )

                  .setEmoji(
                    '🔇'
                  )

                  .setValue(
                    'timeout_10m'
                  ),

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Timeout — 1 heure'
                  )

                  .setEmoji(
                    '🔇'
                  )

                  .setValue(
                    'timeout_1h'
                  ),

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Timeout — 24 heures'
                  )

                  .setEmoji(
                    '🔇'
                  )

                  .setValue(
                    'timeout_24h'
                  ),

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Kick'
                  )

                  .setEmoji(
                    '👢'
                  )

                  .setValue(
                    'kick'
                  ),

                new StringSelectMenuOptionBuilder()

                  .setLabel(
                    'Ban'
                  )

                  .setEmoji(
                    '🔨'
                  )

                  .setValue(
                    'ban'
                  )

              );


          const row =
            new ActionRowBuilder()
              .addComponents(
                menu
              );


          await interaction.reply({

            content:
              '🟡 Choisis la nouvelle sanction. Les votes actuels seront remis à zéro.',

            components: [
              row
            ],

            ephemeral:
              true

          });

          return;
        }


        // ================================
        // VOTE POUR
        // ================================

        if (
          action ===
          'pour'
        ) {

          if (
            request.votesPour.has(
              interaction.user.id
            ) ||
            request.votesContre.has(
              interaction.user.id
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


          // L'ADMIN tranche immédiatement
          if (
            isAdmin(
              interaction.member
            )
          ) {

            request.votesPour.add(
              interaction.user.id
            );

            await approveSanction(
              request,
              interaction,
              'Décision administrateur.'
            );


            await interaction.reply({

              content:
                '👑 Décision administrative : **sanction validée immédiatement**.',

              ephemeral:
                true

            });

            return;
          }


          request.votesPour.add(
            interaction.user.id
          );


          const votes =
            countVotes(
              request
            );


          if (
            votes.pour >=
            3
          ) {

            await approveSanction(
              request,
              interaction,
              '3 votes modérateurs favorables.'
            );


            await interaction.reply({

              content:
                '🟢 **3 votes Pour atteints.** La demande est validée.',

              ephemeral:
                true

            });

            return;
          }


          await updateSanctionMessage(
            request
          );


          await interaction.reply({

            content:
              `🟢 Ton vote **Pour** est enregistré. ${votes.pour}/3 votes nécessaires.`,

            ephemeral:
              true

          });

          return;
        }


        // ================================
        // VOTE CONTRE
        // ================================

        if (
          action ===
          'contre'
        ) {

          if (
            request.votesPour.has(
              interaction.user.id
            ) ||
            request.votesContre.has(
              interaction.user.id
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


          // L'ADMIN peut refuser immédiatement
          if (
            isAdmin(
              interaction.member
            )
          ) {

            request.votesContre.add(
              interaction.user.id
            );

            await rejectSanction(
              request,
              interaction,
              'Décision administrateur.'
            );


            await interaction.reply({

              content:
                '👑 Décision administrative : **demande refusée immédiatement**.',

              ephemeral:
                true

            });

            return;
          }


          request.votesContre.add(
            interaction.user.id
          );


          await updateSanctionMessage(
            request
          );


          await interaction.reply({

            content:
              '🔴 Ton vote **Contre** est enregistré. La demande reste en attente.',

            ephemeral:
              true

          });

          return;
        }

      }


      // ==================================
      // MENU MODIFICATION
      // ==================================

      if (
        interaction.isStringSelectMenu()
      ) {

        if (
          !interaction.customId.startsWith(
            'sanction_change_'
          )
        ) {

          return;
        }


        if (
          !isModerator(
            interaction.member
          )
        ) {

          await interaction.reply({

            content:
              '❌ Seuls les modérateurs peuvent modifier une sanction.',

            ephemeral:
              true

          });

          return;
        }


        const requestId =
          interaction.customId.replace(
            'sanction_change_',
            ''
          );


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


        if (
          request.status !==
          'pending'
        ) {

          await interaction.reply({

            content:
              '❌ Cette demande a déjà été traitée.',

            ephemeral:
              true

          });

          return;
        }


        const newSanction =
          interaction.values[0];


        request.sanction =
          newSanction;


        // Modification = nouveau vote
        request.votesPour.clear();
        request.votesContre.clear();


        await updateSanctionMessage(
          request
        );


        await interaction.reply({

          content:
            `🟡 Sanction modifiée en **${getSanctionLabel(newSanction)}**. Les votes ont été remis à zéro.`,

          ephemeral:
            true

        });


        console.log(
          'Sanction modifiée pour la demande :',
          request.id,
          '→',
          newSanction
        );

      }

    } catch (error) {

      console.error(
        'Erreur interaction sanction :',
        error
      );


      if (
        interaction.replied ||
        interaction.deferred
      ) {

        return;
      }


      try {

        await interaction.reply({

          content:
            '❌ Une erreur est survenue.',

          ephemeral:
            true

        });

      } catch {

        // Rien à faire si Discord refuse la réponse.

      }

    }

  }
);


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
// ENREGISTREMENT COMMANDE /sanction
// ========================================

async function registerCommands() {

  if (!process.env.DISCORD_TOKEN) {

    console.error(
      'DISCORD_TOKEN absent : impossible d enregistrer les commandes.'
    );

    return;
  }


  const commands = [

    new SlashCommandBuilder()

      .setName(
        'sanction'
      )

      .setDescription(
        'Créer une demande de sanction'
      )

      .addUserOption(
        option =>

          option

            .setName(
              'membre'
            )

            .setDescription(
              'Membre concerné'
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
              'Sanction proposée'
            )

            .setRequired(
              true
            )

            .addChoices(

              {
                name:
                  '⚠️ Avertissement',

                value:
                  'warning'
              },

              {
                name:
                  '🔇 Timeout — 10 minutes',

                value:
                  'timeout_10m'
              },

              {
                name:
                  '🔇 Timeout — 1 heure',

                value:
                  'timeout_1h'
              },

              {
                name:
                  '🔇 Timeout — 24 heures',

                value:
                  'timeout_24h'
              },

              {
                name:
                  '👢 Kick',

                value:
                  'kick'
              },

              {
                name:
                  '🔨 Ban',

                value:
                  'ban'
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
              'Raison de la demande'
            )

            .setRequired(
              true
            )

      )

      .toJSON()

  ];


  const rest =
    new REST({

      version:
        '10'

    }).setToken(
      process.env.DISCORD_TOKEN
    );


  try {

    console.log(
      'Enregistrement de /sanction...'
    );


    await rest.put(

      Routes.applicationCommands(
        process.env.DISCORD_CLIENT_ID
      ),

      {
        body:
          commands
      }

    );


    console.log(
      '/sanction enregistrée avec succès.'
    );


  } catch (error) {

    console.error(
      'Erreur enregistrement commandes Discord :',
      error
    );

  }

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
      'Aucun statut personnalisé configuré.'
    );

    await registerCommands();

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
// DEBUG
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

console.log(
  'Salon sanctions configuré :',
  SANCTION_CHANNEL_ID
);

console.log(
  'Rôle modérateur configuré :',
  MODERATOR_ROLE_ID
);

console.log(
  'Rôle admin configuré :',
  ADMIN_ROLE_ID
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
