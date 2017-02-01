var GoogleSpreadsheet = require('google-spreadsheet'),
    async = require('async'),
    csv = require('csv'),
    fs = require('fs'),
    aws = require('aws-sdk'),
    exec = require('child_process').exec,
    s3 = new aws.S3(),
    ses = new aws.SES({region: "eu-west-1"}),
    sanitize = require("sanitize-filename"),
    zipFolder = require('zip-folder');

//////////// GLOBAL VARIABLES ////////////

var generationFolder = "/tmp/csvs_"+ (new Date()).getTime();
var bucketName = "navision-to-csv";
var bucketDir = null; // Must be configured in event.json
var notificationEmails = null; // Must be configured in event.json
var emailSubject = null; // Must be configured in event.json
var entryPoint = ""; // "http" or "cron"

//////////// AWS LAMBDA ENTRY POINT ////////////

module.exports.convert_http = function(event, context, callback) {
  performConversion(JSON.parse(event.body), 'http', callback);
};

/**
 * Triggers the periodic generation of TCK dedications file.
 */
module.exports.convert_schedule = function(event, context, callback) {
  console.log("[INFO] Starting generation of TCK dedications.");
  performConversion(require('./event-tck.json'), 'cron', callback);
};

/**
 * Triggers the periodic generation of TCA dedications file.
 */
module.exports.convert_schedule_tca = function(event, context, callback) {
  console.log("[INFO] Starting generation of TCA dedications.");
  performConversion(require('./event-tca.json'), 'cron', callback);
};

function performConversion(eventData, conversionTriggeredBy, callback) {
  if (!eventData.hasOwnProperty('documentIds')) {
    throw "The event must contain a list of 'documentIds'";
  }
  if (!eventData.hasOwnProperty('bucketDir')) {
    throw "The event must contain a 'bucketDir' that specifies the generation directory in bucket";
  }
  if (!eventData.hasOwnProperty('notificationEmails')) {
    throw "The event must contain a list of 'notificationEmails' that will be notified";
  }
  if (!eventData.hasOwnProperty('emailSubject')) {
    throw "The event must contain an 'emailSubject' for the notification";
  }
  // Set up gloal variables
  entryPoint = conversionTriggeredBy;
  bucketDir = eventData.bucketDir;
  notificationEmails = eventData.notificationEmails;
  emailSubject = eventData.emailSubject;
  // Start conversion
  getSheets(eventData.documentIds, function (sheetsWithDocuments) {
    processSheets(sheetsWithDocuments, function (generated, failed) {
      generateBundle(function (bundlePath) {
        sendNotificationMail(bundlePath, generated, failed, function() {
          console.log("[INFO] Processing finished.");
          callback(null, bundlePath);
        });
      });
    });
  });
}

//////////// HIGH LEVEL FILE PROCESSING ////////////

/**
 * Iterates over each document getting its worksheets. Each worksheet is
 * represented as an object that contains the sheet and the parent document:
 *
 *    { sheet: sheetObject, document: documentObject }
 *
 * After all sheets have been retrieved. Calls the given `callback` passing the
 * list of obtained sheets with their respective documents.
 */
function getSheets(documentIds, callback) {
  var credentials = require('./resources/credentials.json');
  var getSheetsFromDocument = function (documentId, step) {
    var doc = new GoogleSpreadsheet(documentId);
    doc.useServiceAccountAuth(credentials, function (err) {
      if (err) { throw err; }
      doc.getInfo(function (err, info) {
        console.log("[INFO] Getting sheets from document: '"+ info.title +"'.");
        var sheetsWithDoc = info.worksheets.map(function (sheet) { return {document: info, sheet: sheet}; });
        step(null, sheetsWithDoc);
      });
    });
  };
  async.map(documentIds, getSheetsFromDocument, function (err, listOfSheets) {
    if (err) { throw err; }
    callback([].concat.apply([], listOfSheets));
  });
}

/**
 * Generates CSV files for the given list of sheets with documents. Calls the given callback after
 * generating all files.
 */
function processSheets(sheetsWithDocuments, callback) {
  var generated = [];
  var failed = [];
  var processSheet = function (sheetWithDocument, step) {
    var sheet = sheetWithDocument.sheet;
    var document = sheetWithDocument.document;
    console.log("[INFO] Processing sheet: '"+ sheet.title +"'.");
    async.waterfall([
      async.apply(_getProjectName, document, sheet),
      _getProjectId,
      _getResources,
      _getResourceDepartments,
      _getResourceDedications,
      _generateCSV
    ], function (err, document, sheet, projectData) {
      if (err) {
        console.error("[ERROR] Could not generate CSV for sheet '"+ sheet.title +"' of document '"+ document.title +"'");
        failed.push("<li>No se ha podido generar CSV para la hoja '"+ sheet.title +"' del documento '"+ document.title +"'</li>");
      } else {
        console.log("[SUCCESS] Generated CSV for sheet '"+ sheet.title +"' of document '"+ document.title +"'");
        generated.push("<li>Generado CSV para la hoja '"+ sheet.title +"' del documento '"+ document.title +"'</li>");
      }
      // We set a time of 5 seconds between executions to sending too much requests to Google Drive
      // API. When we make too much requests and too fast, Google Drive API blocks us for a few seconds
      // making subsequent requests fail.
      console.log("[INFO] Sheet: '"+ sheet.title +"' processed.");
      step(); // Keep processing even when a file fails
    });
  };
  // Process the sheets (maximum 3 concurrently)
  async.eachLimit(sheetsWithDocuments, 3, processSheet, function (err) {
    if (err) { throw err; }
    callback(generated, failed);
  });
}

/**
 * Generates a ZIP and calls the given callback with its path.
 */
function generateBundle(callback) {
  var bundleName = _getBundleName();
  // Aggregates all files (without the first line) in the generation folder
  exec("ls -Q | xargs -n 1 tail -n +2", {cwd: generationFolder}, function (err, aggregated, stderr) {
    if (err) { throw err; }
    // Gets the first line of the first file in the generation folder
    // Since all files SHOULD have the same header, it does matter which file we get it from
    exec('head -n1 "$(ls | head -n1)"', {cwd: generationFolder}, function (err, headline, stderr) {
      if (err) { throw err; }
      // Concatenate the header + the aggregated and upload it to s3
      s3.upload({Bucket: bucketName, Key: bucketDir +"/"+ bundleName, Body: headline + aggregated, ACL: "public-read"}, function (err, data) {
        if (err) { throw err; }
        console.log("[SUCCESS] Bundle "+ bundleName +" uploaded to S3. Can be downloaded at "+ data.Location);
        callback(data.Location);
      });
    });
  });
}

function sendNotificationMail(bundlePath, generatedFiles, failedFiles, callback) {
  report = "<h2>INFORME</h2>:";
  report = "<p>La generación de ficheros ha finalizado. El agregado puede descargarse en: "+ bundlePath +"</p>";
  if (failedFiles.length > 0) {
    report += "<h3>Errores:</h3>";
    report += "<ul>" + failedFiles.join("") + "</ul>";
  }
  report += "<h3>Correctos:</h3>";
  report += "<ul>"+ generatedFiles.join("") + "</ul>";

  var params = {
    Destination: {
      BccAddresses: ["cristian.alvarez@the-cocktail.com"],
      CcAddresses: [],
      ToAddresses: notificationEmails,
    },
    Message: {
      Body: {
        Html: {
          Data: report.replace("\n", " \n<br> "),
          Charset: 'UTF-8'
        },
        Text: {
          Data: report,
          Charset: 'UTF-8'
        }
      },
      Subject: {
        Data: emailSubject +' - Generado: '+  (new Date()).toGMTString(),
        Charset: 'UTF-8'
      }
    },
    Source: 'cristian.alvarez@the-cocktail.com',
  };
  ses.sendEmail(params, function(err, data) {
    if (err) { throw err; }
    console.log("[INFO] Sending notification mail.");
    callback();
  });
}

//////////// LOW LEVEL FILE PROCESSING ////////////

function _getProjectName(document, sheet, callback) {
  var projectNameCell = {'min-row': 2, 'max-row': 2, 'min-col': 3, 'max-col': 3};
  sheet.getCells(projectNameCell, function (err, cells) {
    try {
      // We only expect a single cell.
      var projectData = {name: cells[0].value};
      callback(null, document, sheet, projectData);
    } catch (e) {
      callback(e, document, sheet, null);
    }
  });
}

function _getProjectId(document, sheet, projectData, callback) {
  var projectIdCell = {'min-row': 1, 'max-row': 1, 'min-col': 4, 'max-col': 4};
  sheet.getCells(projectIdCell, function (err, cells) {
    try {
      // We only expect a single cell.
      projectData.code = cells[0].value;
      callback(null, document, sheet, projectData);
    } catch (e) {
      callback(e, document, sheet, projectData);
    }
  });
}

function _getResources(document, sheet, projectData, callback) {
  var resourceCells = {'min-row': 5, 'max-row': 5, 'return-empty': false};
  sheet.getCells(resourceCells, function (err, cells) {
    try {
      projectData.resources = cells.map(function (cell) {
        return {name: cell.value.replace("\n", " ")};
      });
      callback(null, document, sheet, projectData);
    } catch (e) {
      callback(e, document, sheet, projectData);
    }
  });
}

function _getResourceDepartments(document, sheet, projectData, callback) {
  var departmentCells = {'min-row': 3, 'max-row': 3, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
  sheet.getCells(departmentCells, function (err, cells) {
    try {
      var departments = cells.map(function (cell) { return cell.value; });
      departments.forEach(function (department, index) {
        projectData.resources[index].department = department;
      });
      callback(null, document, sheet, projectData);
    } catch (e) {
      callback(e, document, sheet, projectData);
    }
  });
}

function _getResourceDedications(document, sheet, projectData, callback) {
  var weekCells = {'min-row': 15, 'min-col': 1, 'max-col': 1};
  sheet.getCells(weekCells, function (err, cells) {
    try {
      // We store an array of every registered week converted into a Date object.
      // Values that are not dates will be stored as null.
      var weeks = cells.map(_parseWeek);
      var dedicationCells = {'min-row': 15, 'max-row': 15 + weeks.length - 1, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
      // Once we have registered all weeks, we go for the dedications.
      sheet.getCells(dedicationCells, function (err, cells) {
        if (err) { return callback(err, document, sheet, projectData); }
        projectData.resources = projectData.resources.map(function (resource, index) {
          var resourceCol = 3 + index;
          var resourcehours = [];
          if (cells) {
            resourceHours = cells.filter(function (cell) { return cell.col == resourceCol; });
          }
          // For each resource we get its dedicated hours, which are stored in an array
          // so the resourceHours[X] represents the hours dedicated in the week[X]
          resource.dedications = weeks.map(function (week, index) { return {week: week, dedication: resourceHours[index].value}; })
                                      .filter(function (dedication) { return dedication.week !== null; });
          return resource;
        });
        callback(null, document, sheet, projectData);
      });
    } catch (e) {
      callback(e, document, sheet, projectData);
    }
  });
}

function _generateCSV(document, sheet, projectData, callback) {
  var weeks = projectData.resources[0].dedications.map(function (dedication) {
    return dedication.week.getDate() + "/" + (dedication.week.getMonth() + 1) + "/" + dedication.week.getFullYear();
  });
  var data = [];
  // Create headers
  data.push(["Codigo Proyecto", "Proyecto", "Recurso"].concat(weeks));
  // Add entires for resources
  projectData.resources.forEach(function (resource) {
    var hours = resource.dedications.map(function (d) { return d.dedication; });
    data.push([projectData.code, projectData.name, resource.name].concat(hours));
  });
  // Output the CSV file
  csv.stringify(data, {header: true, delimiter: ';', quote: true}, function(err, data) {
    if (!fs.existsSync(generationFolder)) {
      fs.mkdirSync(generationFolder);
    }
    fs.writeFileSync(generationFolder + "/" + sanitize(projectData.name) + ".csv", data);
    callback(null, document, sheet, projectData);
  });
}

//////////// HELPERS ////////////

function _parseWeek(cell) {
  var components = cell.value.split("/").map(function (x) { return parseInt(x); });
  // Dates come in a format DD/MM/YYYY
  if (components.length === 3) {
    // JS requires months to start in 0, not 1.
    return new Date(Date.UTC(components[2], components[1] - 1, components[0]));
  } else {
    return null;
  }
}

function _getBundleName() {
  var date = new Date();
  var month = (date.getUTCMonth() + 1);
  // Sets the prefixes to print dates with two numbers. For example the mont 1 would be printed as "01".
  var ensurePrefix = function(x) { return x < 10 ? "0" + x : x; };
  var dateFormatted = date.getUTCFullYear() +"-"+ ensurePrefix(month) +"-"+ date.getUTCDate() +"-"+ ensurePrefix(date.getUTCHours()) +"-"+ ensurePrefix(date.getUTCMinutes());
  return "dedications_"+ dateFormatted +".csv";
}
