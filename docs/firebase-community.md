# Configuración del chat con Firebase

El chat usa Firebase Authentication anónima y Realtime Database bajo el nodo raíz `MalibuWeb Chat`, con las ramas `messages` y `presence`. No almacena el apodo fuera del mensaje ni tiene una función programada de limpieza. Muestra como máximo los 100 mensajes dentro de las últimas 18 horas; cuando alguien abre el chat, intenta borrar los mensajes expirados que encuentre (hasta 100 por conexión). Por eso la retención es aproximada: si nadie entra, datos expirados pueden permanecer en la base.

## Firebase Console

1. En **Authentication → Sign-in method**, habilita **Anonymous**.
2. En **Realtime Database**, copia la URL y configúrala como `PUBLIC_FIREBASE_DATABASE_URL`.
3. En **Realtime Database → Rules**, publica el contenido de `database.rules.json`.
4. En **Project settings → General → Your apps**, usa la configuración de la aplicación web para completar las variables indicadas abajo.

Las reglas exigen autenticación anónima, validan longitud y formato de mensajes, limitan presencia al UID propio y solo permiten borrar mensajes cuando ya expiraron. No habilites lectura/escritura pública.

## Compilación local

El `.env` local (ignorado por Git) debe tener estas variables `PUBLIC_`:

```dotenv
PUBLIC_FIREBASE_API_KEY=
PUBLIC_FIREBASE_AUTH_DOMAIN=
PUBLIC_FIREBASE_DATABASE_URL=
PUBLIC_FIREBASE_PROJECT_ID=
PUBLIC_FIREBASE_STORAGE_BUCKET=
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
PUBLIC_FIREBASE_APP_ID=
```

Astro incorpora estos valores públicos en el JavaScript generado. La configuración web de Firebase no es una clave de servidor; la seguridad depende de las reglas de la base.

## GitHub Actions / Azure Static Web Apps

Agrega los siete valores como **GitHub Actions Secrets** del repositorio, con los mismos nombres `PUBLIC_FIREBASE_*` (Settings → Secrets and variables → Actions → New repository secret). El workflow los necesita durante la compilación; configurarlos solo en Azure después del build no basta. Aunque Firebase web config es visible en la aplicación, usar Secrets funciona si la opción de Variables no está disponible.

La API antigua de Azure aún está en el repositorio y el workflow puede seguir desplegándola, pero el cliente del chat ya no la utiliza. Firebase aplica sus propias cuotas y límites; esta implementación no añade Cloud Functions, Web PubSub ni Storage para el chat.
