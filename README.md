# Project Manager GSheets to CSV

Script que genera ficheros en el formato CSV requerido por el ERP de navision
a partir de las hojas de cálculo de Google Spreadsheets de los jefes de proyecto.

Actualmente existen dos funciones que generan unos ficheros para TCK y para TCA.
La configuración de dichas funciones puede verse en los ficheros `event-tca.json`
y `event-tck.json`.

Las funciones procesan la lista de documentos que tienen configurada en sus
respectivos ficheros de configuración, generan un CSV agregando los datos de
todos ellos y lo suben a un bucket de Amazon S3.  Una vez subido al bucket se
envía un email de notificación a las direcciones configuradas.

* [1. Instalación](#1-instalación)
    * [1.1 Versiones](#11-versiones)
    * [1.2 Obteniendo las credenciales](#12-obteniendo-las-credenciales)
    * [1.3 Añadiendo un nuevo documento a la lista de procesamiento](#13-añadiendo-un-nuevo-documento-a-la-lista-de-procesamiento)
* [2. Despliegue y ejecución](#2-despliegue-y-ejecución)
    * [2.1 Ejecución en local](#21-ejecución-en-local)
    * [2.2 Despliegue y ejecución en producción](#22-despliegue-y-ejecución-en-producción)
* [3. Documentación](#3-documentación)
    * [3.1 Puntos de entrada](#31-puntos-de-entrada)
    * [3.2 Proceso de conversión](#32-proceso-de-conversión)

## 1. Instalación

### 1.1 Versiones

Este proyecto funciona sobre NodeJS 4.3.2.

### 1.2 Obteniendo las credenciales

Es necesario tener un fichero `credentials.json` en el directorio `resources` para
que el script pueda autenticarse correctamente contra la API de Google Spreadsheets.

También necesitaremos configurar [Tacoma](https://github.com/pantulis/tacoma)
para poder desplegar e invocar las funciones de AWS Lambda.

Tanto el fichero `credentials.json` como las credenciales de Tacoma están
disponibles en el Keepass de desarrollo, en la carpeta "Modelo Imputación Horas".

### 1.3 Añadiendo un nuevo documento a la lista de procesamiento

En el fichero `credentials.json` verás un `client_email`. Para permitir que el
script procese un fichero ese necesario seguir estos pasos:

  1. En Google Spreadsheets, comparte el documento en cuestión con el email que
  ves en `client_email`.
  2. Copia el Id del documento, puedes verlo en su URL cuando lo tengas abierto
  con el navegador.
  3. Añade el documentID del documento que quieres procesar al campo `documentIds`
  del fichero `event-tca.json` o `event-tck.json`.

## 2. Despliegue y ejecución

## 2.1 Ejecución en local

Para simular en local la ejecución de AWS Lambda hay que usar el paquete
`serverless-offline`.  Sólo es necesario ejecutar el comando
`node_modules/.bin/serverless offline start` en la raíz de nuestro proyecto.

## 2.2 Despliegue y ejecución en producción

Para desplegar podemos usar el comando `node_modules/.bin/serverless deploy`, lo
que nos generará un fichero `.zip` que desplegará en AWS Lambda.  El `.zip` que
se despliega podemos verlo en el directorio `.serverless` de nuestro proyecto.

Todas las noches se ejecutarán automáticamente las funciones `generateCsvSchedule`
y `generateCsvTcaSchedule`.

Si queremos invocar manualmente alguna de estas funciones podemos usar el
comando `node_modules/.bin/serverless invoke -f NOMBRE-DE-LA-FUNCION`.

## 3. Documentación

### 3.1 Puntos de entrada

Nuestro fichero `handler.js` contiene todo el código del script de conversión.
Este fichero exporta 3 funciones que conforman los puntos de entrada para las
3 funciones lambda que tenemos.

Cada uno de estos puntos de entrada invoca a la función `performConversion` con
la configuración adecuada.
Esta función valida los datos de configuración y lanza el proceso de conversión.

### 3.2 Proceso de conversión

El proceso de conversión está compuesto por un pipeline de 4 funciones.

  * La función `getSheets` realiza una petición al API de Google Spreadsheets
  para obtener las hojas que componen cada documento.  Una vez obtenidas las
  hojas de todos los documentos llama a la función `processSheets`.
  * La función `processSheets` se encarga de procesar cada hoja. Las hojas se
  procesan con un paralelismo de 3. Para procesar cada hoja se ejecutan las
  siguientes funciones.
    * `_getProjectName`: obtiene el valor de la casilla que indica el nombre del proyecto.
    * `_getProjectId`: obtiene el valor de la casilla que indica el ID del proyecto.
    * `_getResources`: obtiene los nombres de todos los recursos del proyecto.
    * `_getResourceDepartments`: obtiene los departamentos de todos los recursos del proyecto.
    * `_getResourceDedications`: obtiene las dedicaciones de todos los recursos del proyecto.
    * `_generateCsv`: genera el CSV con los datos obtenidos.
  * Una vez procesadas todas las hojas se invoca a la función `generateBundle`.
  Esta función utiliza una serie de comandos shell para concatenar los CSVs
  generados previamente en un único fichero. Tras generar el fichero concatenado
  éste se sube a un bucket de Amazon S3.
  * Por último se invoca la función `sendNotificationMail` que envía el email
  de notificación con un enlace al fichero concatenado generado anteriormente.
