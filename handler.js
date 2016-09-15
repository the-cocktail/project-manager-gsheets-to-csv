GoogleSpreadsheet = require('google-spreadsheet');
async = require('async');
csv = require('csv');
fs = require('fs');
aws = require('aws-sdk');
s3 = new aws.S3();
ses = new aws.SES({region: "eu-west-1"});

//////////// GLOBAL VARIABLES ////////////

var globals = {
  invokationDate: new Date(), // The date in which the event was invoked
  eventOrigin: "", // "http" or "cron",
  erroredFiles: [], // Files with errors. All have a `sheet` and a `document`
  generatedFiles: [], // Files with no errors. All have a `sheet` a `document` and a `file`
  sheetsToProcess: new Set(), // Contains the IDs of the sheets that must be processed.
};

//////////// AWS LAMBDA ENTRY POINT ////////////

module.exports.convert_http = function(event, context, callback) {
  globals.eventOrigin = "http";
  if (!event.body.hasOwnProperty('documentIds')) {
    throw "The event must contain a list of 'documentIds'";
  }
  event.body.documentIds.forEach(function (documentId) {
    processDocument(documentId, function() {
      var errors = globals.erroredFiles.map(function (err) {
        return "[ERROR] Sheet '"+ err.sheet +"' of document '"+ err.document +"'";
      });
      var successes = globals.generatedFiles.map(function (suc) {
        return "[SUCCESS] Sheet '"+ suc.sheet +"' of document '"+ suc.document +"'";
      });
      callback(null, "Process finished:\n"+ errors.join("\n") +"\n"+ successes.join("\n"));
    });
  });
};

module.exports.convert_schedule = function(event, context, responseCallback) {
  globals.eventOrigin = "cron";
  // TODO 95% equal to `convert_http`
};


//////////// DOCUMENT PROCESSING FUNCTIONS ////////////

function processDocument(documentId, responseCallback) {
  var doc = new GoogleSpreadsheet(documentId);
  var creds = require('./resources/credentials.json');
  doc.useServiceAccountAuth(creds, function (err) {
    doc.getInfo(function (err, info) {
      info.worksheets.forEach(function (sheet) {
        globals.sheetsToProcess.add(sheet.id);
        async.waterfall([
          async.apply(getProjectName, info, sheet),
          getProjectId,
          getResources,
          getResourceDepartments,
          getResourceDedications,
          generateCSV,
        ], function (err, document, sheet, projectData, generatedFileData) {
          // Remove the current sheet of the list of sheets to be processed
          globals.sheetsToProcess.delete(sheet.id); 
          if (err) { // If there is a failure log it and add it to the list of errored files.
            console.error("[ERROR] Could not generate CSV for sheet '"+ sheet.title +"' of document '"+ document.title +"'");
            console.error(err.stack);
            globals.erroredFiles.push({sheet: sheet.title, document: document.title});
          } else { // If all is OK add the new file to the list of generated files.
            console.log("[SUCCESS] Generated CSV for sheet '"+ sheet.title +"' of document '"+ document.title +"'");
            globals.generatedFiles.push({
              sheet: sheet.title,
              document: document.title,
              file: generatedFileData.key
            });
          }
          if (globals.sheetsToProcess.size === 0) { // Computation finished. Send notification
            responseCallback();
          }
        });
      });
    });
  });
}

function getProjectName(document, sheet, callback) {
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

function getProjectId(document, sheet, projectData, callback) {
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

function getResources(document, sheet, projectData, callback) {
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

function getResourceDepartments(document, sheet, projectData, callback) {
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

function getResourceDedications(document, sheet, projectData, callback) {
  var weekCells = {'min-row': 15, 'min-col': 1, 'max-col': 1};
  sheet.getCells(weekCells, function (err, cells) {
    try {
      // We store an array of every registered week converted into a Date object.
      // Values that are not dates will be stored as null.
      var weeks = cells.map(_parseWeek);
      var dedicationCells = {'min-row': 15, 'max-row': 15 + weeks.length - 1, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
      // Once we have registered all weeks, we go for the dedications.
      sheet.getCells(dedicationCells, function (err, cells) {
        projectData.resources = projectData.resources.map(function (resource, index) {
          var resourceCol = 3 + index;
          var resourceHours = cells.filter(function (cell) { return cell.col == resourceCol; });
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

function generateCSV(document, sheet, projectData, callback) {
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
    var fileName = _getDateFolder() + "/" + projectData.name + "_" + globals.invokationDate.getTime() + ".csv";
    var dir = globals.eventOrigin === "cron" ? "cron/" : "http/";
    s3.upload({Bucket: "navision-to-csv", Key: dir + fileName, Body: data}, {}, function(err, generatedFileData) {
      if (err) {
        callback(e, document, sheet, projectData);
      } else {
        callback(null, document, sheet, projectData, generatedFileData);
      }
    });
  });
}

//////////// HELPER FUNCTIONS ////////////
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

function _getDateFolder() {
  var date = globals.invokationDate;
  var month = (date.getUTCMonth() + 1);
  // Sets the prefixes to print dates with two numbers. For example the mont 1 would be printed as "01".
  var ensurePrefix = function(x) {
    return x < 10 ? "0" + x : x;
  }
  return date.getUTCFullYear() +"/"+ ensurePrefix(month) +"/"+ date.getUTCDate() + "/"+ ensurePrefix(date.getHours()) + "/"+ ensurePrefix(date.getMinutes());
}

function _sendNotificationMail(responseCallback) {
  var params = {
    Destination: {
      BccAddresses: [],
      CcAddresses: [],
      ToAddresses: ["cristian.alvarez@the-cocktail.com"]
    },
    Message: {
      Body: {
        Html: {
          Data: '<h1>Message</h1>',
          Charset: 'UTF-8'
        },
        Text: {
          Data: '# Message',
          Charset: 'UTF-8'
        }
      },
      Subject: {
        Data: 'TEST SUBJECT',
        Charset: 'UTF-8'
      }
    },
    Source: 'cristian.alvarez@the-cocktail.com',
  };
  ses.sendEmail(params, function(err, data) {
    if (err) {
      console.error(err);
      responseCallback("The email could not be sent. See the logs.");
    } else {
      console.log(data);
      responseCallback("The email was sent.");
    }
  });
}