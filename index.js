var GoogleSpreadsheet = require('google-spreadsheet');
var async = require('async');
var csv = require('csv');
var fs = require('fs');


//////////// AWS LAMBDA ENTRY POINT ////////////

exports.handler = function(event, context) {
  if (!event.hasOwnProperty('documentId')) {
    throw "The event must contain a 'documentId'";
  }
  async.waterfall([
    async.apply(processDocument, new GoogleSpreadsheet(event.documentId)),
    getProjectName,
    getProjectId,
    getResources,
    getResourceDepartments,
    getResourceDedications,
  ], function (err, sheet, projectData) {
    if (err) {
      throw err;
    } else {
      generateCSV(sheet, projectData);
    }
  });
};

//////////// DOCUMENT PROCESSING FUNCTIONS ////////////

function processDocument(doc, callback) {
  var creds = require('./resources/credentials.json');
  doc.useServiceAccountAuth(creds, function (err) {
    doc.getInfo(function (err, info) {
      info.worksheets.forEach(function (sheet) { callback(err, sheet); });
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
  var weeks = projectData.resources[0].dedications.map(_formatDateFromDedication);
  var data = [];
  // Create headers
  data.push(["Proyecto", "Recurso"].concat(weeks).concat(["Codigo Proyecto"]));
  // Add entires for resources
  projectData.resources.forEach(function (resource) {
    var hours = resource.dedications.map(function (d) { return d.dedication; });
    data.push([projectData.name, resource.name].concat(hours).concat(projectData.code));
  });
  // Output the CSV file
  csv.stringify(data, {header: true}, function(err, data) {
    var date = new Date();
    var fileName = projectData.name + "_" + sheet.title + "_" + date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate() + ".csv";
    fs.writeFileSync("generated/"+ fileName, data);
    console.log("Generated \""+ fileName + "\"");
  });
}

//////////// HELPER FUNCTIONS ////////////
function _parseWeek(cell) {
  var components = cell.value.split("/").map(function (x) { return parseInt(x); });
  // Dates come in a format MM/DD/YYYY
  if (components.length === 3) {
    // JS requires months to start in 0, not 1.
    return new Date(Date.UTC(components[2], components[0] - 1, components[1]));
  } else {
    return null;
  }
}

function _formatDateFromDedication(dedication) {
  var months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var formatted = dedication.week.getDate() + "/" + (dedication.week.getMonth() + 1) + "/" + dedication.week.getFullYear();
  return formatted + " ("+ months[dedication.week.getMonth()] +")";
}
