var GoogleSpreadsheet = require('google-spreadsheet');
var async = require('async');
var csv = require('csv');

async.waterfall([
  loadDocument,
  getProjectName,
  getProjectId,
  getResources,
  getResourceDepartments,
  getResourceDedications,
], function (err, projectData) {
  if (err) {
    throw err;
  } else {
    generateCSV(projectData);
  }
});

function loadDocument(callback) {
  var doc = new GoogleSpreadsheet('1H6oKo71NOapisLnjHltXbDlyLfp28U4Bni5SHyt1u48');
  var creds = require('./credentials.json');
  doc.useServiceAccountAuth(creds, function (err) {
    callback(err, doc);
  });
}

function getProjectName(doc, callback) {
  var projectNameCell = {'min-row': 2, 'max-row': 2, 'min-col': 3, 'max-col': 3};
  doc.getCells(1, projectNameCell, function (err, cells) {
    // We only expect a single cell.
    var project = {name: cells[0].value};
    callback(null, doc, project);
  });
}

function getProjectId(doc, projectData, callback) {
  var projectIdCell = {'min-row': 1, 'max-row': 1, 'min-col': 4, 'max-col': 4};
  doc.getCells(1, projectIdCell, function (err, cells) {
    // We only expect a single cell.
    projectData.code = cells[0].value;
    callback(null, doc, projectData);
  });
}

function getResources(doc, projectData, callback) {
  var resourceCells = {'min-row': 5, 'max-row': 5, 'return-empty': false};
  doc.getCells(1, resourceCells, function (err, cells) {
    projectData.resources = cells.map(function (cell) {
      return {name: cell.value.replace("\n", " ")};
    });
    callback(null, doc, projectData);
  });
}

function getResourceDepartments(doc, projectData, callback) {
  var departmentCells = {'min-row': 3, 'max-row': 3, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
  doc.getCells(1, departmentCells, function (err, cells) {
    var departments = cells.map(function (cell) { return cell.value; });
    departments.forEach(function (department, index) {
      projectData.resources[index].department = department;
    });
    callback(null, doc, projectData);
  });
}

function getResourceDedications(doc, projectData, callback) {
  var weekCells = {'min-row': 15, 'min-col': 1, 'max-col': 1};
  doc.getCells(1, weekCells, function (err, cells) {
    // We store an array of every registered week converted into a Date object.
    // Values that are not dates will be stored as null.
    var weeks = cells.map(_parseWeek);
    var dedicationCells = {'min-row': 15, 'max-row': 15 + weeks.length - 1, 'min-col': 3, 'max-col': 3 + projectData.resources.length - 1, 'return-empty': true};
    // Once we have registered all weeks, we go for the dedications.
    doc.getCells(1, dedicationCells, function (err, cells) {
      projectData.resources = projectData.resources.map(function (resource, index) {
        var resourceCol = 3 + index;
        var resourceHours = cells.filter(function (cell) { return cell.col == resourceCol; });
        // For each resource we get its dedicated hours, which are stored in an array
        // so the resourceHours[X] represents the hours dedicated in the week[X]
        resource.dedications = weeks.map(function (week, index) { return {week: week, dedication: resourceHours[index].value}; })
                                    .filter(function (dedication) { return dedication.week !== null; });
        return resource;
      });
      callback(null, projectData);
    });
  });
}

function generateCSV(projectData) {
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
  csv.stringify(data, {header: true}, function(err, data) { process.stdout.write(data); });
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
