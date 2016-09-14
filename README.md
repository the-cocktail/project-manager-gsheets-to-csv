# Project Manager GSheets to CSV

Script que genera ficheros en el formato CSV requerido por el ERP de navision
a partir de las hojas de cálculo de Google Spreadsheets de los jefes de proyecto.

Para invocar a la función lambda es necesario pasarle un evento con el siguiente
formato:

```json
{
  "documentIds": ["XXXXXXX", "YYYYYYY"]
}
```


## Obteniendo las credenciales

Es necesario tener un fichero `credentials.json` en el directorio `resources` para
que el script pueda autenticarse correctamente contra la API de Google Spreadsheets.

Para ver ver cómo obtener este fichero puedes consultar las [instrucciones](https://github.com/theoephraim/node-google-spreadsheet#service-account-recommended-method)
del paquete `google-spreadsheet`.

## Obteniendo los IDs de los documentos

En el fichero `credentials.json` verás un `client_email`. Para permitir que el
script procese un fichero ese necesario seguir estos pasos:

  1. En Google Spreadsheets, comparte el documento en cuestión con el email que
  ves en `client_email`.
  2. Al ejecutar el lambda, hay que pasar un evento que contenga la propiedad
  `documentIds` como un array con IDs de documentos.

## Configurando la integración con S3

Para poder subir los ficheros generados a Amazon S3 es necesario crear un fichero
de configuración llamado `aws.json` en el directorio `resources` con el siguiente
aspecto:

```json
{
  "bucket": "xxxxxx"
}
```

En producción se usarán las claves del IAM profile que use la función lambda.

## Ejecución en local

Importante este proyecto utiliza la versión **4.3.2** de nodejs.

Para simular en local la ejecución de AWS Lambda hay que usar el paquete `serverless-offline`.
Sólo es necesario ejecutar el comando `serverless offline start` en la raíz de nuestro proyecto.
