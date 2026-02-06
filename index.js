const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys')

const ffmpegPath = require('ffmpeg-static')
const fs = require('fs')
const P = require('pino')
const qrcode = require('qrcode-terminal')
const yts = require('yt-search')
const { tmpdir } = require('os')
const path = require('path')
const { spawn } = require('child_process')

const OWNER_NUMBERS = [
  '50375279321@s.whatsapp.net', // tu número creador principal
  '50360891037@s.whatsapp.net'  // número del bot
]

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['M4k bot', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) {
      console.log('📱 Escanea este QR:')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'open') console.log('✅ M4k bot conectado')
    if (connection === 'close') startBot()
  })

  sock.ev.on('group-participants.update', async (update) => {
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'

    if (update.action === 'add' && update.participants.includes(botJid)) {
      const adder = update.author

      if (!OWNER_NUMBERS.includes(adder)) {
        await sock.sendMessage(update.id, {
          text: '❌ No estoy autorizado a estar en este grupo.\nSolo mi creador puede agregarme.'
        })
        await sock.groupLeave(update.id)
      } else {
        await sock.sendMessage(update.id, {
          text: '✅ Bot agregado correctamente por el creador.'
        })
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const sender = msg.key.participant || msg.key.remoteJid
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      (msg.message.imageMessage?.caption) ||
      (msg.message.videoMessage?.caption) ||
      ''

    if (!text.startsWith('.')) return

    const args = text.slice(1).trim().split(/ +/)
    const command = args.shift().toLowerCase()

    async function reply(txt) {
      await sock.sendMessage(from, { text: txt })
    }

    // MENU
    if (command === 'menu') {
      const menuPrivado = `
📋 *MENÚ M4K BOT* (Privado)

👤 *Privado*:
• .play <canción>
• .sticker
• .menu
• .creador
      `.trim()

      const menuGrupo = `
📋 *MENÚ M4K BOT* (Grupo)

👥 *Grupo* (solo admins):
• .todos
• .ban @usuario
• .close
• .open
• .closefor <minutos>

👤 *Privado*:
• .menu
• .creador
      `.trim()

      return reply(isGroup ? menuGrupo : menuPrivado)
    }

    // CREATOR
    if (command === 'creador' || command === 'owner') {
      return reply('📲 Contacta con el creador:\n+50375279321')
    }

    // Bloquear .play en grupos
    if (
      isGroup &&
      ['play'].includes(command)
    ) {
      return reply('❌ Este comando solo se puede usar en privado con el bot')
    }

    // SOLO PRIVADO - PLAY
if (!isGroup && command === 'play') {
  if (!args.length) return reply('❌ Escribe el nombre de la canción')

  await reply('🎵 Buscando canción...')

  try {
    const search = await yts(args.join(' '))
    const video = search.videos[0]

    if (!video) return reply('❌ No encontré resultados')
    if (video.seconds > 480) return reply('⏱️ Máximo 8 minutos')

    await reply(`🎶 Descargando:\n${video.title}`)

    const file = path.join(tmpdir(), `audio_${Date.now()}.mp3`)

    const stream = ytdl(video.url, {
      filter: 'audioonly',
      quality: 'highestaudio'
    })

    const writeStream = fs.createWriteStream(file)
    stream.pipe(writeStream)

    writeStream.on('finish', async () => {
      await sock.sendMessage(from, {
        audio: fs.readFileSync(file),
        mimetype: 'audio/mpeg'
      })

      fs.unlinkSync(file)
    })

  } catch (err) {
    console.error(err)
    return reply('❌ Falló la descarga')
  }
}


     // COMANDO STICKER (.sticker)
if (command === 'sticker') {
  // Verificar que el mensaje contenga imagen o video
  const messageType = Object.keys(msg.message)[0]

  // Solo funciona si el mensaje tiene imagen o video para convertir en sticker
  if (messageType === 'imageMessage' || messageType === 'videoMessage') {
    try {
      // Descargar el contenido multimedia
      const stream = await downloadContentFromMessage(msg.message[messageType], messageType === 'imageMessage' ? 'image' : 'video')
      let buffer = Buffer.from([])

      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }

      // Convertir a sticker usando ffmpeg
      const tempFile = path.join(tmpdir(), `temp_${Date.now()}`)
      const inputFile = `${tempFile}.${messageType === 'imageMessage' ? 'jpg' : 'mp4'}`
      const outputFile = `${tempFile}.webp`

      // Guardar archivo temporal
      fs.writeFileSync(inputFile, buffer)

      // Convertir con ffmpeg
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
  '-i', inputFile,
  '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15',
  '-vcodec', 'libwebp',
  '-lossless', '1',
  '-preset', 'default',
  '-an',
  '-vsync', '0',
  outputFile
])


        ffmpeg.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error('Error al convertir el sticker'))
        })
      })

      // Leer archivo webp convertido
      const webpBuffer = fs.readFileSync(outputFile)

      // Enviar sticker
      await sock.sendMessage(from, { sticker: webpBuffer })

      // Eliminar archivos temporales
      fs.unlinkSync(inputFile)
      fs.unlinkSync(outputFile)

    } catch (e) {
      console.error(e)
      await reply('❌ Error al crear el sticker. Asegúrate de enviar una imagen o video válido.')
    }
  } else {
    await reply('❌ Por favor, envía una imagen o video con el comando .sticker para convertirlo en sticker.')
  }
}


    // Bloquear comandos de grupo en privado excepto .menu y .creador
    if (
      !isGroup &&
      ['todos', 'ban', 'close', 'open', 'closefor'].includes(command)
    ) {
      return reply('❌ Este comando solo se puede usar en grupos')
    }

    if (!isGroup) return

    // Obtener metadata y permisos
    const metadata = await sock.groupMetadata(from)
    const participant = metadata.participants.find(p => p.id === sender)
    const isAdmin = participant?.admin || false
    const isOwner = OWNER_NUMBERS.includes(sender)

    if (!isAdmin && !isOwner) {
      return reply('❌ Solo admins pueden usar estos comandos')
    }

    // COMANDO TODOS (.todos)
    if (command === 'todos') {
      const mentions = metadata.participants.map(p => p.id)
      const textAll = '📢 Todos:\n' + mentions.map(m => '@' + m.replace('@s.whatsapp.net', '')).join(' ')
      return sock.sendMessage(from, {
        text: textAll,
        mentions
      })
    }

    // BAN
    if (command === 'ban' && msg.message.extendedTextMessage) {
      const mentioned = msg.message.extendedTextMessage.contextInfo.mentionedJid
      if (!mentioned || mentioned.length === 0) return reply('❌ Menciona a alguien para banear')
      const user = mentioned[0]
      await sock.groupParticipantsUpdate(from, [user], 'remove')
      return reply(`🚫 Usuario eliminado`)
    }

    // CLOSE (cerrar grupo)
    if (command === 'close') {
      await sock.groupSettingUpdate(from, 'announcement')
      return reply('🔒 Grupo cerrado, solo admins pueden enviar mensajes')
    }

    // OPEN (abrir grupo)
    if (command === 'open') {
      await sock.groupSettingUpdate(from, 'not_announcement')
      return reply('🔓 Grupo abierto para todos')
    }

    // CLOSEFOR <minutos>
    if (command === 'closefor' && args[0]) {
      const minutes = parseInt(args[0])
      if (isNaN(minutes) || minutes <= 0) return reply('❌ Ingresa un número válido de minutos')

      await sock.groupSettingUpdate(from, 'announcement')
      await reply(`⏳ Grupo cerrado por ${minutes} minuto(s)`)

      setTimeout(async () => {
        await sock.groupSettingUpdate(from, 'not_announcement')
        await reply('🔓 Grupo reabierto automáticamente')
      }, minutes * 60000)
    }
  })
}

startBot()

