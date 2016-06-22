var GoogleSpreadsheet = require('google-spreadsheet'),
    async = require('async'),
    doc = new GoogleSpreadsheet('1H6oKo71NOapisLnjHltXbDlyLfp28U4Bni5SHyt1u48');

async.waterfall([
  setAuth,
  getProjectName,
  getProjectId,
  getResources,
  getResourceDepartments
], function (err, document) {
  console.log(document);
});

// Authenticate with Google Drive
function setAuth(callback) {
  var creds = require('./credentials.json');
  doc.useServiceAccountAuth(creds, callback);
}

function getProjectName(callback) {
  var projectNameCell = {'min-row': 2, 'max-row': 2, 'min-col': 3, 'max-col': 3};
  doc.getCells(1, projectNameCell, function (err, cells) {
    // We only expect a single cell.
    var project = {name: cells[0].value};
    callback(null, project);
  });
}

function getProjectId(project, callback) {
  var projectIdCell = {'min-row': 1, 'max-row': 1, 'min-col': 4, 'max-col': 4};
  doc.getCells(1, projectIdCell, function (err, cells) {
    // We only expect a single cell.
    project.code = cells[0].value;
    callback(null, project);
  });
}

function getResources(project, callback) {
  var resourceCells = {'min-row': 5, 'max-row': 5, 'return-empty': false};
  doc.getCells(1, resourceCells, function (err, cells) {
    project.resources = cells.map(function (cell) {
      return {name: cell.value.replace("\n", " ")};
    });
    callback(null, project);
  });
}

function getResourceDepartments(project, callback) {
  var departmentCells = {
    'min-row': 3,
    'max-row': 3,
    'min-col': 3,
    'max-col': 3 + project.resources.length - 1,
    'return-empty': true
  };
  doc.getCells(1, departmentCells, function (err, cells) {
    console.log(cells);
    var departments = cells.map(function (cell) { return cell.value; });
    departments.forEach(function (department, index) {
      project.resources[index].department = department;
    });
    callback(null, project);
  });
}

function getResourceDedications(project, callback) {

}
