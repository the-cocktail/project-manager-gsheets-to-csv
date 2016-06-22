# Obteniendo las credenciales

Es necesario tener un fichero `credentials.json` en el directorio `resources` para
que el script pueda autenticarse correctamente contra la API de Google Spreadsheets.

Para ver ver cómo obtener este fichero puedes consultar las [instrucciones](https://github.com/theoephraim/node-google-spreadsheet#service-account-recommended-method)
del paquete `google-spreadsheet`.

# Obteniendo los IDs de los documentos

En el fichero `credentials.json` verás un `client_email`. Para permitir que el
script procese un fichero ese necesario seguir estos pasos:

  1. En Google Spreadsheets, comparte el documento en cuestión con el email que
  ves en `client_email`.
  2. Toma nota del ID de documento y añádelo al fichero `documents.json` del
  directorio `resources`.
