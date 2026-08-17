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
  PermissionFlagsBits
} = require('discord.js');


// ============================================================
// CONFIGURATION
// ============================================================

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


// ------------------------------------------------------------
// INSULTES GÉNÉRALES
// ------------------------------------------------------------

const GENERAL_INSULTS = [

  'connard',
  'connasse',
  'con',
  'conne',
  'pute',
  'salope',
  'encule',
  'enculé',
  'fdp',
  'tg',
  'ntm',
  'merde',
  'putain'

];


// ------------------------------------------------------------
// TERMES À SURVEILLER PARTICULIÈREMENT
// ------------------------------------------------------------
//
// Cette liste reste volontairement vide ici.
// Tu pourras ajouter les termes que TU veux
// surveiller selon les règles de ton serveur.
//
// Nexus ne sanctionnera jamais automatiquement.
// Il créera seulement une demande.
// ------------------------------------------------------------

const SENSITIVE_PATTERNS = [

  // Ajoute ici les termes à surveiller
  // selon les règles de ton serveur.

];


// ============================================================
// MÉMOIRE
// ============================================================

// Twitch
let lastAnnouncedStreamId = null;


// Auto-modération
const detectionTracker =
  new Map();

const sanctionCooldowns =
  new Map();


// Demandes de sanctions
const sanctionRequests =
  new Map();


// ============================================================
// CLIENT DISCORD
// ============================================================

const client =
  new Client({

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

  return text

    .toLowerCase()

    .normalize('NFD')

    .replace(
      /[\u0300-\u036f]/g,
      ''
    )

    .replace(
      /[_\-.,!?;:/\\]+/g,
      ' '
    )

    .replace(
      /\s+/g,
      ' '
    )

    .trim();

}


function containsWord(
  content,
  word
) {

  const normalizedContent =
    normalizeText(content);

  const normalizedWord =
    normalizeText(word);

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
// DÉTECTION AUTO-MOD
// ============================================================

function detectModeration(
  content
) {

  let general =
    false;

  let sensitive =
    false;


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
// ENREGISTRER UNE DÉTECTION
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


  if (
    type === 'general'
  ) {

    data.general.push(
      now
    );

  }


  if (
    type === 'sensitive'
  ) {

    data.sensitive.push(
      now
    );

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


    console.log(
      'Access Token Twitch renouvelé avec succès.'
    );


    // Twitch peut fournir un nouveau refresh token.
    // Il devra ensuite être sauvegardé dans Render.
    if (
      data.refresh_token
    ) {

      process.env.TWITCH_REFRESH_TOKEN =
        data.refresh_token;

      console.log(
        'Nouveau Refresh Token Twitch reçu.'
      );

    }


    return true;


  } catch (error) {

    console.error(
      'Erreur connexion Twitch :',
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


    console.log(
      'Compte Twitch trouvé :',
      data.data[0].login
    );


    return data.data[0].id;


  } catch (error) {

    console.error(
      'Erreur récupération utilisateur Twitch :',
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
      'Erreur profil Twitch :',
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
        'Erreur récupération live Twitch :',
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


// ============================================================
// ALERTE TWITCH
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
        'Salon Twitch introuvable.'
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
      'Erreur annonce Twitch :',
      error.message
    );

    return false;

  }

}


// ============================================================
// TWITCH EVENTSUB
// ============================================================

async function createStreamOnlineSubscription(
  sessionId,
  userId
) {

  const accessToken =
    process.env.TWITCH_ACCESS_TOKEN;


  if (!accessToken) {

    console.error(
      'Access Token absent pour EventSub.'
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
        'Erreur EventSub :',
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


// ============================================================
// EVENTSUB
// ============================================================

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


        // ----------------------------------
        // WELCOME
        // ----------------------------------

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


        // ----------------------------------
        // NOTIFICATION
        // ----------------------------------

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
              'Nouveau live détecté.',
              streamId
            );


            // Anti-doublon
            if (
              lastAnnouncedStreamId ===
              streamId
            ) {

              console.log(
                'Live déjà annoncé.'
              );

              return;

            }


            const stream =
              await getTwitchStream(
                userId
              );


            if (!stream) {

              console.error(
                'Informations live introuvables.'
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


        // ----------------------------------
        // RECONNECT
        // ----------------------------------

        if (
          messageType ===
          'session_reconnect'
        ) {

          const reconnectUrl =
            message.payload &&
            message.payload.session &&
            message.payload.session.reconnect_url;


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


      } catch (error) {

        console.error(
          'Erreur EventSub :',
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
        'Connexion EventSub fermée.'
      );

    }
  );


  return ws;

}


// ============================================================
// CRÉER UNE DEMANDE DE SANCTION
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

    const channel =
      await client.channels.fetch(
        SANCTION_CHANNEL_ID
      );


    if (!channel) {

      console.error(
        'Salon demandes-sanctions introuvable.'
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

        .setColor(
          0xFFA500
        )

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

        });


    if (
      detectedMessage
    ) {

      embed.addFields({

        name:
          '💬 Message concerné',

        value:
          detectedMessage.slice(
            0,
            1000
          )

      });

    }


    embed.setFooter({

      text:
        `Nexus • ID ${requestId}`

    });


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
      'Demande de sanction créée :',
      requestId
    );


    return request;


  } catch (error) {

    console.error(
      'Erreur création demande sanction :',
      error.message
    );

    return null;

  }

}


// ============================================================
// PERMISSIONS MODÉRATEUR
// ============================================================

function canModerate(
  interaction
) {

  return interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.ManageMessages
    );

}


function isAdmin(
  interaction
) {

  return interaction.memberPermissions &&
    interaction.memberPermissions.has(
      PermissionFlagsBits.Administrator
    );

}


// ============================================================
// TRAITER UN VOTE
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


  // ----------------------------------------
  // ADMIN
  // ----------------------------------------

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
      request,
      interaction
    );


    return;

  }


  // ----------------------------------------
  // EMPÊCHER DOUBLE VOTE
  // ----------------------------------------

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


  // ----------------------------------------
  // ENREGISTRER LE VOTE
  // ----------------------------------------

  if (
    vote === 'yes'
  ) {

    request.yesVotes.add(
      voterId
    );

  }
  else {

    request.noVotes.add(
      voterId
    );

  }


  // ----------------------------------------
  // 3 POUR
  // ----------------------------------------

  if (
    request.yesVotes.size >= 3
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
      request,
      interaction
    );


    return;

  }


  // ----------------------------------------
  // MISE À JOUR DU MESSAGE
  // ----------------------------------------

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
// FINALISER UNE DEMANDE
// ============================================================

async function finalizeSanctionRequest(
  request,
  interaction
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


    // ----------------------------------------
    // IMPORTANT
    // ----------------------------------------
    //
    // Pour le moment, aucune vraie sanction
    // Discord n'est appliquée.
    //
    // On teste d'abord tout le système.
    //
    console.log(
      approved
        ? 'Demande validée — sanction NON appliquée pour le moment.'
        : 'Demande refusée.'
    );


  } catch (error) {

    console.error(
      'Erreur finalisation sanction :',
      error.message
    );

  }

}


// ============================================================
// MODIFIER LA SANCTION
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
      '🟡 La modification de sanction sera ajoutée dans la prochaine étape du système.',

    ephemeral:
      true

  });

}


// ============================================================
// METTRE À JOUR UNE DEMANDE
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
      'Erreur mise à jour demande :',
      error.message
    );

  }

}


// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  'interactionCreate',
  async function (interaction) {

    try {

      // ======================================
      // SLASH COMMAND
      // ======================================

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


        // ----------------------------------
        // PROTECTION CONTRE SOI-MÊME
        // ----------------------------------

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


        const member =
          await guild.members.fetch(
            target.id
          );


        // ----------------------------------
        // PROTECTION CONTRE UN ADMIN
        // ----------------------------------

        if (
          member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {

          await interaction.reply({

            content:
              '❌ Une demande automatique ne peut pas viser un administrateur.',

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


      // ======================================
      // BOUTONS
      // ======================================

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

          return;

        }

      }

    } catch (error) {

      console.error(
        'Erreur interaction :',
        error
      );


      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({

          content:
            '❌ Une erreur est survenue.',

          ephemeral:
            true

        });

      }

    }

  }
);


// ============================================================
// AUTO-MODÉRATION
// ============================================================

client.on(
  'messageCreate',
  async function (message) {

    if (
      message.author.bot
    ) {

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


    // ----------------------------------------
    // CONTENU SENSIBLE
    // ----------------------------------------

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


    // ----------------------------------------
    // INSULTES RÉPÉTÉES
    // ----------------------------------------

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
// COMMANDES SLASH
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
// ENREGISTREMENT SLASH COMMAND
// ============================================================

async function registerCommands() {

  try {

    if (
      !process.env.DISCORD_TOKEN
    ) {

      console.error(
        'DISCORD_TOKEN absent.'
      );

      return;

    }


    if (
      !process.env.DISCORD_CLIENT_ID
    ) {

      console.error(
        'DISCORD_CLIENT_ID absent.'
      );

      return;

    }


    const rest =
      new REST({

        version:
          '10'

      }).setToken(
        process.env.DISCORD_TOKEN
      );


    await rest.put(

      Routes.applicationCommands(
        process.env.DISCORD_CLIENT_ID
      ),

      {

        body: [

          sanctionCommand.toJSON()

        ]

      }

    );


    console.log(
      'Commande /sanction enregistrée.'
    );


  } catch (error) {

    console.error(
      'Erreur enregistrement commandes :',
      error
    );

  }

}


// ============================================================
// READY
// ============================================================

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


// ============================================================
// ERREURS DISCORD
// ============================================================

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


// ============================================================
// DEBUG DISCORD
// ============================================================

client.on(
  'debug',
  function (message) {

    console.log(
      '[DEBUG]',
      message
    );

  }
);


// ============================================================
// SHARD
// ============================================================

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


// ============================================================
// SERVEUR HTTP RENDER
// ============================================================

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
      // OAUTH TWITCH
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
              'Erreur OAuth Twitch :',
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

          }


          console.log(
            'OAuth Twitch terminé avec succès.'
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
            'Erreur OAuth :',
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
            '<h1>Erreur</h1>'
          );

        }


        return;

      }


      // ----------------------------------
      // 404
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


// ============================================================
// SERVEUR
// ============================================================

server.listen(
  PORT,
  function () {

    console.log(
      'Serveur HTTP actif sur le port ' +
      PORT
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
      'Impossible d’initialiser Twitch.'
    );

    return;

  }


  const userId =
    await getTwitchUserId(
      TWITCH_USERNAME
    );


  if (!userId) {

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


// ============================================================
// DIAGNOSTIC
// ============================================================

console.log(
  'Discord Token présent :',
  !!process.env.DISCORD_TOKEN
);

console.log(
  'Discord Client ID présent :',
  !!process.env.DISCORD_CLIENT_ID
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


// ============================================================
// LOGIN DISCORD
// ============================================================

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


// ============================================================
// TWITCH
// ============================================================

initializeTwitch();


// ============================================================
// HEARTBEAT
// ============================================================

setInterval(
  function () {

    console.log(
      'Nexus est toujours actif'
    );

  },
  30000
);
