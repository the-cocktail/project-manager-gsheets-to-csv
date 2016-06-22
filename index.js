var GoogleSpreadsheet = require('google-spreadsheet'),
    async = require('async');

async.waterfall([
  loadDocument,
  getProjectName,
  getProjectId,
  getResources,
  getResourceDepartments
], function (err, document) {
  console.log(document);
});

function loadDocument(callback) {
  var doc = new GoogleSpreadsheet('1H6oKo71NOapisLnjHltXbDlyLfp28U4Bni5SHyt1u48'),
      creds = require('./credentials.json');
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

function getProjectId(doc, project, callback) {
  var projectIdCell = {'min-row': 1, 'max-row': 1, 'min-col': 4, 'max-col': 4};
  doc.getCells(1, projectIdCell, function (err, cells) {
    // We only expect a single cell.
    project.code = cells[0].value;
    callback(null, doc, project);
  });
}

function getResources(doc, project, callback) {
  var resourceCells = {'min-row': 5, 'max-row': 5, 'return-empty': false};
  doc.getCells(1, resourceCells, function (err, cells) {
    project.resources = cells.map(function (cell) {
      return {name: cell.value.replace("\n", " ")};
    });
    callback(null, doc, project);
  });
}

function getResourceDepartments(doc, project, callback) {
  var departmentCells = {
    'min-row': 3,
    'max-row': 3,
    'min-col': 3,
    'max-col': 3 + project.resources.length - 1,
    'return-empty': true
  };
  doc.getCells(1, departmentCells, function (err, cells) {
    var departments = cells.map(function (cell) { return cell.value; });
    departments.forEach(function (department, index) {
      project.resources[index].department = department;
    });
    callback(null, doc, project);
  });
}

function getResourceDedications(doc, project, callback) {
  // TODO fill with code
}
