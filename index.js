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
  TextInputStyle
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

let lastAnnouncedStreamId =
  null;


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
// SYSTÈME DE SANCTIONS
// ========================================

// Stockage temporaire.
// Les demandes sont perdues si Nexus redémarre.

const sanctionRequests =
  new Map();


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


    // Twitch peut fournir un nouveau refresh token.
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


        // -----------------------------
        // WELCOME
        // -----------------------------

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


        // -----------------------------
        // NOTIFICATION
        // -----------------------------

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


        // -----------------------------
        // KEEPALIVE
        // -----------------------------

        if (
          messageType ===
          'session_keepalive'
        ) {

          return;

        }


        // -----------------------------
        // RECONNECT
        // -----------------------------

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


        // -----------------------------
        // REVOCATION
        // -----------------------------

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
// DISCORD — INTERACTIONS
// ========================================

client.on(
  'interactionCreate',
  async function (
    interaction
  ) {

    try {

      // --------------------------------
      // On accepte uniquement boutons
      // et modals.
      // --------------------------------

      if (
        !interaction.isButton() &&
        !interaction.isModalSubmit()
      ) {

        return;

      }


      // --------------------------------
      // Vérification du salon
      // --------------------------------

      if (
        interaction.channelId !==
        SANCTION_CHANNEL_ID
      ) {

        return;

      }


      // --------------------------------
      // Permissions
      // --------------------------------

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


        // --------------------------------
        // Une modification invalide
        // les anciens votes.
        // --------------------------------

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


        // --------------------------------
        // ADMIN
        // --------------------------------

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


        // --------------------------------
        // MODO
        // --------------------------------

        // Si le modo avait voté contre,
        // son vote contre est supprimé.

        request.votesNo.delete(
          userId
        );


        // Son vote pour est ajouté.

        request.votesYes.add(
          userId
        );


        const yesCount =
          request.votesYes.size;


        // --------------------------------
        // 3 VOTES POUR
        // --------------------------------

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


        // --------------------------------
        // PAS ENCORE 3 VOTES
        // --------------------------------

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


        // --------------------------------
        // ADMIN
        // --------------------------------

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


        // --------------------------------
        // MODO
        // --------------------------------

        // Si le modo avait voté pour,
        // son vote pour est supprimé.

        request.votesYes.delete(
          userId
        );


        // Son vote contre est ajouté.

        request.votesNo.add(
          userId
        );


        const noCount =
          request.votesNo.size;


        // --------------------------------
        // 3 VOTES CONTRE
        // --------------------------------

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


        // --------------------------------
        // PAS ENCORE 3 VOTES
        // --------------------------------

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
// COMMANDE !SANCTION
// ========================================

client.on(
  'messageCreate',
  async function (
    message
  ) {

    if (
      message.author.bot
    ) {

      return;

    }


    if (
      !message.guild
    ) {

      return;

    }


    if (
      !message.content.startsWith(
        '!sanction'
      )
    ) {

      return;

    }


    const member =
      message.member;


    if (!member) {

      return;

    }


    const isModerator =
      member.roles.cache.has(
        MOD_ROLE_ID
      );


    const isAdmin =
      member.roles.cache.has(
        ADMIN_ROLE_ID
      );


    if (
      !isModerator &&
      !isAdmin
    ) {

      await message.reply(
        '❌ Tu n’as pas la permission d’utiliser cette commande.'
      );


      return;

    }


    // --------------------------------
    // ARGUMENTS
    // --------------------------------

    const args =
      message.content
        .slice(
          '!sanction'.length
        )
        .trim()
        .split('|')
        .map(
          function (value) {

            return value.trim();

          }
        );


    if (
      args.length < 3
    ) {

      await message.reply(
        '❌ Utilisation : `!sanction @membre | sanction proposée | raison | source`'
      );


      return;

    }


    const memberMention =
      args[0];


    const sanction =
      args[1];


    const reason =
      args[2];


    const source =
      args[3] ||
      'Non renseignée';


    // --------------------------------
    // VALIDATION
    // --------------------------------

    if (!sanction) {

      await message.reply(
        '❌ Tu dois indiquer une sanction.'
      );


      return;

    }


    if (!reason) {

      await message.reply(
        '❌ Tu dois indiquer une raison.'
      );


      return;

    }


    const memberMatch =
      memberMention.match(
        /^<@!?(\d+)>$/
      );


    if (!memberMatch) {

      await message.reply(
        '❌ Tu dois mentionner le membre concerné.'
      );


      return;

    }


    const targetMemberId =
      memberMatch[1];


    // --------------------------------
    // CRÉATION
    // --------------------------------

    const requestId =
      await createSanctionRequest({

        memberId:
          targetMemberId,

        sanction:
          sanction,

        reason:
          reason,

        source:
          source,

        createdBy:
          message.author.id

      });


    if (!requestId) {

      await message.reply(
        '❌ Impossible de créer la demande de sanction.'
      );


      return;

    }


    await message.reply(
      '✅ Demande de sanction créée dans le salon de modération.'
    );

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


        // -----------------------------
        // REFUS
        // -----------------------------

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


        // -----------------------------
        // CODE ABSENT
        // -----------------------------

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
