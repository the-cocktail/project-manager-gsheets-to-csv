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
  2. Al ejecutar el lambda, hay que pasar un evento que contenga la propiedad
  `documentIds` como un array con IDs de documentos.

# Ejecución en local

Para simular en local la ejecución de AWS Lambda hay que usar el paquete
[node-lambda](https://www.npmjs.com/package/node-lambda).

  1. Con el comando `node-lambda setup` podemos crear los ficheros necesarios
  para simular el entorno de ejecución de AWS Lambda. En concreto podemos usar
  el fichero `event.json` para simular el evento que recibe el script al ejecutarse
  en AWS lambda.
  2. Con el comando `node-lambda run` podemos lanzar la ejecución del script. Es
  importante especificar los IDs de los documentos a procesar bajo la clave
  `documentIds` en el fichero `event.json` tal y como se indica previamente.
