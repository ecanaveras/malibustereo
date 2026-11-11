# Contador y chat en vivo de Malibú Stereo

Astro sigue estático. El workflow existente ahora despliega `api/` como Azure Functions administradas (Node 22). Web PubSub distribuye mensajes en vivo y Azure Table Storage guarda únicamente identificadores anónimos y fechas para presencia y límites de envío. No se escribe ningún apodo ni mensaje en una base de datos ni en un archivo; el apodo se guarda solo en el navegador (`localStorage`) para no pedirlo en cada visita.

## Recursos y configuración

1. En la suscripción de la emisora, crear los dos recursos de `infra/community.bicep`: Web PubSub y StorageV2 Standard LRS. La plantilla no modifica el sitio existente. Revisar coste y región antes de desplegar; Storage tiene coste por consumo. `Free_F1` admite **20 conexiones simultáneas**, no 20 personas: cada pestaña consume una conexión. Para mayor audiencia, elegir y presupuestar `Standard_S1`.
2. Usar un prefijo único de 3 a 16 letras minúsculas/dígitos que empiece por una letra. Con Azure CLI autenticado, desde la raíz del repositorio:

   ```powershell
   az deployment group create --resource-group <grupo> --template-file infra/community.bicep --parameters prefix=<prefijo> pubsubSku=Free_F1
   ```

3. En **Static Web App → Settings → Environment variables**, configurar estas variables para el entorno de producción. No ponerlas en `PUBLIC_*`, GitHub, el código ni el chat:

   | Variable | Valor |
   | --- | --- |
   | `COMMUNITY_PUBSUB_CONNECTION` | Connection string del recurso Web PubSub |
   | `COMMUNITY_STORAGE_CONNECTION` | Connection string del Storage creado |
   | `COMMUNITY_SESSION_SECRET` | Secreto aleatorio de al menos 32 caracteres, estable entre despliegues |
   | `COMMUNITY_ORIGINS` | Orígenes HTTPS permitidos separados por comas, sin barra final: dominio público y dominio azurestaticapps.net si se usan ambos |
   | `COMMUNITY_HUB` | `malibu` |
   | `COMMUNITY_TABLE` | `MalibuPresence` |

   La API crea la tabla en su primer uso. Las claves se usan únicamente en servidor. Los navegadores reciben un acceso WebSocket de cinco minutos sin permiso de publicar directamente. No configurar event handlers ni habilitar live trace de mensajes en Web PubSub: el envío pasa por la API HTTP del sitio.

4. Publicar la rama mediante el flujo habitual a `main`. El workflow prueba la API y luego despliega Astro y Functions. Los entornos de preview necesitan configuración propia y preferiblemente otro hub/tabla para no mezclar su chat con producción.
5. Verificar con dos navegadores: contador 1 → 2; envío recibido en ambos; otra pestaña del mismo navegador no aumenta el contador; recargar borra los mensajes anteriores; desconectar y reconectar recupera el servicio; cerrar un navegador reduce el conteo después del plazo de presencia.

## Comportamiento y límites

- Se cuentan navegadores activos, no reproducciones ni personas verificadas. Un dispositivo adicional o borrar las cookies genera otra identidad. Una cookie HttpOnly firmada dura 30 días y se comparte entre pestañas. Web Locks serializa la primera creación de sesión en navegadores compatibles; navegadores antiguos sin Web Locks pueden duplicar una primera apertura simultánea.
- Cada conexión confirma presencia cada 25 segundos. Una presencia sin confirmación vence a los 75 segundos; el cambio aparece en el siguiente refresco del observador. Pestañas suspendidas por el móvil pueden dejar de contar hasta reactivarse.
- El chat se encuentra en la portada justo debajo del reproductor; en el resto de páginas que usan `BaseLayout` aparece antes del pie. El reproductor tiene otro indicador del mismo conteo.
- Al intentar escribir en el chat se pide un apodo en una ventana modal centrada; se recuerda en el navegador y puede cambiarse tocando la inicial del apodo. El campo apodo del formulario es oculto, así que la validación se hace en el cliente antes de enviar.
- Los mensajes admiten emojis desde un selector integrado. Enter envía el mensaje; Shift + Enter inserta un salto de línea.
- Máximo 24 caracteres por apodo y 300 por mensaje; un envío cada 3 segundos por identidad, aplicado en el servidor con escritura condicional. Esto limita repeticiones casuales; no es protección completa contra bots que renueven identidad. No hay cuentas verificadas, moderación automática ni panel de administración en este alcance.
- El servidor no conserva conversaciones. Cada página retiene en memoria hasta 100 mensajes recibidos; recargar los borra. Los mensajes enviados durante una desconexión no se recuperan.
- La tabla guarda únicamente filas `presence`/`throttle` con identificador aleatorio y fecha. Se limpian por lotes de hasta 20 filas con más de un día, una vez por minuto por instancia mientras haya tráfico; sin tráfico pueden permanecer hasta la siguiente visita. Esto no es historial de mensajes.
- No se anuncia cero ni se habilita Enviar si la API falla. El cliente reintenta con espera creciente hasta 30 segundos y mantiene el borrador tras un error. Un envío cuyo resultado sea incierto no se repite automáticamente.
- Un hub dedicado por sitio evita mezclar conversaciones. Nunca compartir este hub con otros productos.

## Verificación local

```powershell
npm ci
npm run build
npm ci --prefix api
npm test --prefix api
node api/test/local-server.cjs
```

La última orden sirve `http://localhost:4322` con un **doble de prueba local** para Azure y WebSockets reales. Solo escucha en loopback; no usarlo para producción. No requiere claves. Los tests cubren contratos HTTP, deduplicación, expiración, validación, firma, escrituras condicionales y conversación en vivo entre clientes. La verificación real de Azure y del workflow requiere los recursos y credenciales configurados.

Para repetir la prueba visual con Microsoft Edge instalado: `npm run test:browser --prefix api` después de compilar Astro. También se puede instalar Chromium de Playwright y adaptar `BROWSER_CHANNEL`. Las capturas se guardan en `test-output/`, excluido de Git.

## Reversión

Revertir el commit de esta funcionalidad y dejar que el workflow publique el sitio anterior. Los recursos adicionales pueden mantenerse detenidos o retirarse tras comprobar que ningún entorno los usa. No eliminar el Static Web App existente.

## Referencias

- [Functions administradas en Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions)
- [Web PubSub y Static Web Apps](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/tutorial-serverless-static-web-app)
- [Límites de Web PubSub](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-web-pubsub-service-limits)
