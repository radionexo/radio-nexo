# 📻 Radio Nexo - Bot de Retransmisión en Discord (24/7)

Este bot permite que cualquier oyente con **iPhone (iOS)**, **Android** o **PC** escuche Radio Nexo directamente desde un canal de voz de Discord con la máxima calidad, baja latencia y en segundo plano con la pantalla bloqueada.

---

## 🚀 Guía de Configuración en 3 Pasos

### Paso 1: Crear la Aplicación y el Bot en Discord (Toma 2 minutos)
1. Entra al portal de desarrolladores de Discord: **[discord.com/developers/applications](https://discord.com/developers/applications)**.
2. Inicia sesión con tu cuenta de Discord y haz clic en el botón azul superior **"New Application"**.
3. Ponle de nombre: **`Radio Nexo`** y acepta los términos.
4. En el menú de la izquierda, ve a la pestaña **Bot**:
   - Haz clic en **"Reset Token"** (o *Add Bot*) y copia el **Token** generado (guárdalo, lo usaremos enseguida).
   - En la sección **Privileged Gateway Intents**, asegúrate de que esté habilitado o déjalo por defecto.
5. En el menú de la izquierda, ve a **OAuth2 ➔ URL Generator**:
   - En **SCOPES**, marca: `bot`.
   - Abajo en **BOT PERMISSIONS**, marca:
     - `Connect` (Conectar a canales de voz).
     - `Speak` (Hablar / Emitir audio).
     - `View Channels` (Ver canales).
   - Al final de la página, copia la **Generated URL**.
   - Abre esa URL en tu navegador e invita el bot a tu servidor de Discord.

---

### Paso 2: Obtener los IDs de tu Servidor y Canal de Voz
1. En tu aplicación de Discord (PC o móvil), ve a **Ajustes de Usuario ➔ Avanzado** y activa el **"Modo desarrollador"**.
2. **ID del Servidor:** Haz clic derecho sobre el icono de tu servidor de Discord y selecciona **"Copiar ID del servidor"**.
3. **ID del Canal de Voz:** Haz clic derecho sobre el canal de voz donde quieres que transmita la radio (ej: *#Radio Nexo En Vivo*) y selecciona **"Copiar ID del canal"**.

---

### Paso 3: Configurar y Ejecutar el Bot

1. Dentro de la carpeta `discord-bot`, crea un archivo llamado `.env` copiando el `.env.example`:
   ```env
   DISCORD_TOKEN=pega_aqui_el_token_del_paso_1
   GUILD_ID=pega_aqui_el_id_del_servidor
   VOICE_CHANNEL_ID=pega_aqui_el_id_del_canal_de_voz
   STREAM_URL=https://nexo-radio-bridge-axxt.onrender.com/live
   ```

2. Instala las dependencias y enciéndelo:
   ```bash
   cd discord-bot
   npm install
   npm start
   ```

¡Y listo! El bot entrará inmediatamente al canal de voz mostrando el estado `Escuchando RADIO NEXO · En Vivo` y transmitirá el audio para todos tus miembros.
