GoogleSpreadsheet = require('google-spreadsheet');
async = require('async');
csv = require('csv');
fs = require('fs');
aws = require('aws-sdk');
s3 = new aws.S3();
ses = new aws.SES({region: "eu-west-1"});
sanitize = require("sanitize-filename");
zipFolder = require('zip-folder');

//////////// GLOBAL VARIABLES ////////////

var generationFolder = "/tmp/csvs_"+ (new Date()).getTime();
var bucketName = "navision-to-csv";
var entryPoint = ""; // "http" or "cron"

//////////// AWS LAMBDA ENTRY POINT ////////////

module.exports.convert_http = function(event, context, callback) {
  entryPoint = "http";
  if (!event.body.hasOwnProperty('documentIds')) {
    throw "The event must contain a list of 'documentIds'";
  }
  getSheets(event.body.documentIds, function (sheetsWithDocuments) {
    processSheets(sheetsWithDocuments, function (generated, failed) {
      generateBundle(function (bundlePath) {
        sendNotificationMail(bundlePath, generated, failed, function() {
          console.log("[INFO] Processing finished.");
          callback(null, bundlePath);
        });
      });
    });
  });
};

module.exports.convert_schedule = function(event, context, responseCallback) {
  entryPoint = "cron";  
  var eventData = require('./event.json');
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
};

//////////// HIGH LEVEL FILE PROCESSING ////////////

/**
 * Calls the given callback with a list of objects like {sheet: sheetObject, document: documentObject}
 * for the given document ID.
 */
function getSheets(documentIds, callback) {
  var credentials = require('./resources/credentials.json');
  var getSheetsFromDocument = function (documentId, step) {
    var doc = new GoogleSpreadsheet(documentId);
    doc.useServiceAccountAuth(credentials, function (err) {
      if (err) { throw err; }
      doc.getInfo(function (err, info) {
        var sheetsWithDoc = info.worksheets.map(function (sheet) { return({document: info, sheet: sheet}); });
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
      step(); // Keep processing even when a file fails
    });
  };
  async.each(sheetsWithDocuments, processSheet, function (err) {
    if (err) { throw err; }
    callback(generated, failed);
  });
}

/**
 * Generates a ZIP and calls the given callback with its path.
 */
function generateBundle(callback) {
  var bundleName = _getBundleName();
  zipFolder(generationFolder, "/tmp/"+ bundleName, function(err) {
    var bundle = fs.readFileSync("/tmp/"+ bundleName);
    s3.upload({Bucket: bucketName, Key: bundleName, Body: bundle, ACL: "public-read"}, function (err, data) {
      if (err) { throw err; }
      console.log("[SUCCESS] Bundle "+ bundleName +" uploaded to S3. Can be downloaded at "+ data.Location);
      callback(data.Location);
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
      BccAddresses: entryPoint === "cron" ? ["cristian.alvarez@the-cocktail.com"] : [],
      CcAddresses: [],
      ToAddresses: entryPoint === "cron" ? ["finanzas.esp@the-cocktail.com"] : ["cristian.alvarez@the-cocktail.com"],
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
        Data: 'Dedicaciones para Navision. Generado: '+  (new Date()).toGMTString(),
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
        if (err) { return callback(err, document, sheet, projectData); };
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
  return "dedications_"+ dateFormatted +".zip";
}
