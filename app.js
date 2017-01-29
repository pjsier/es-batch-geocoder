var fs = require('fs');
var search = require('./index');
var log = require('single-line-log').stdout;
var colors = require('colors');

var params = {
  inputFile: process.argv[2] || 'test/input.csv',
  outputFile: process.argv[3] || 'output.csv',
  searchIndex: process.argv[4] || 'census',
  geocodeType: process.argv[5] || 'census'
};

search(
  params,
  function (progress) {
    log('Number of requests processed: '.green + progress);
  },
  function () {
    console.log('\nAll done!'.green);
  }
);
