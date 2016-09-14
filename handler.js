GoogleSpreadsheet = require('google-spreadsheet');
async = require('async');
csv = require('csv');
fs = require('fs');
aws = require('aws-sdk');
awsSettings = require('./resources/aws.json');
s3 = new aws.S3();


//////////// AWS LAMBDA ENTRY POINT ////////////

module.exports.convert = function(event, context) {
  if (!event.body.hasOwnProperty('documentIds')) {
    throw "The event must contain a list of 'documentIds'";
  }
  event.body.documentIds.forEach(function (documentId) {
    processDocument(documentId);
  });
};

//////////// DOCUMENT PROCESSING FUNCTIONS ////////////

function processDocument(documentId) {
  var doc = new GoogleSpreadsheet(documentId);
  var creds = require('./resources/credentials.json');
  doc.useServiceAccountAuth(creds, function (err) {
    doc.getInfo(function (err, info) {
      info.worksheets.forEach(function (sheet) {
        async.waterfall([
          async.apply(getProjectName, sheet),
          getProjectId,
          getResources,
          getResourceDepartments,
          getResourceDedications,
        ], function (err, sheet, projectData) {
          if (err) { throw err; }
          generateCSV(sheet, projectData);
        });
      });
    });
  });
}

function getProjectName(sheet, callback) {
  var projectNameCell = {'min-row': 2, 'max-row': 2, 'min-col': 3, 'max-col': 3};
  sheet.getCells(projectNameCell, function (err, cells) {
    // We only expect a single cell.
    var project = {name: cells[0].value};
    callback(null, sheet, project);
  });
}

function getProjectId(sheet, projectData, callback) {
  var projectIdCell = {'min-row': 1, 'max-row': 1, 'min-col': 4, 'max-col': 4};
  sheet.getCells(projectIdCell, function (err, cells) {
    // We only expect a single cell.
    projectData.code = cells[0].value;
    callback(null, sheet, projectData);
  });
}

function getResources(sheet, projectData, callback) {
  var resourceCells = {'min-row': 5, 'max-row': 5, 'return-empty': false};
  sheet.getCells(resourceCells, function (err, cells) {
    projectData.resources = cells.map(function (cell) {
      return {name: cell.value.replace("\n", " ")};
    });
    callback(null, sheet, projectData);
  });
}

function getResourceDepartments(sheet, projectData, callback) {
  var departmentCells = {'min-row': 3, 'max-row': 3, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
  sheet.getCells(departmentCells, function (err, cells) {
    var departments = cells.map(function (cell) { return cell.value; });
    departments.forEach(function (department, index) {
      projectData.resources[index].department = department;
    });
    callback(null, sheet, projectData);
  });
}

function getResourceDedications(sheet, projectData, callback) {
  var weekCells = {'min-row': 15, 'min-col': 1, 'max-col': 1};
  sheet.getCells(weekCells, function (err, cells) {
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
      callback(null, sheet, projectData);
    });
  });
}

function generateCSV(sheet, projectData) {
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
    var date = new Date();
    var fileName = _getDateFolder(date) + projectData.name + "_" + sheet.title + "_" + date.getTime() + ".csv";
    s3.upload({Bucket: awsSettings.bucket, Key: 'csvs/'+ fileName, Body: data}, {}, function(err, data) {
      if (err) { throw err; }
      console.log("Generated: " + data.Location);
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

function _getDateFolder(date) {
  var month = (date.getUTCMonth() + 1);
  var monthWithPrefix = month < 10 ? "0" + month : month;
  return date.getUTCFullYear() +"/"+ monthWithPrefix +"/"+ date.getUTCDate() + "/";
}