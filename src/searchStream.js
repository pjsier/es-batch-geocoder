var util = require('util');
var through = require('through2');
var request = require('request');
var turfAlong = require('turf-along');
var turfLineDistance = require('turf-line-distance');


function createSearchStream(searchIndex, geocodeType) {
  var inFlightCount = 0;

  return through.obj(function (data, enc, next) {
    var self = this;

    inFlightCount++;

    var esBodyPoint = {
      query: {
        bool: {
          must: [
            {term: {"properties.number": data.ADDRESS_NUMBER}},
            {term: {"properties.state": data.STATE_NAME.toLowerCase()}}
          ],
          should: [
            {term: {"properties.zip": data.ZIP_CODE.toString()}},
            {term: {"properties.city": data.PLACE_NAME.toLowerCase()}},
            {term: {"properties.street": data.STREET_NAME_POST_TYPE.toLowerCase()}}
          ]
        }
      }
    }

    var esBodyCensus = {
      query: {
        bool: {
          must: [
            {term: {"properties.STATE": data.STATE_NAME.toLowerCase()}}
          ],
          should: [
            {term: {"properties.ZIPL": data.ZIP_CODE.toString()}},
            {term: {"properties.ZIPR": data.ZIP_CODE.toString()}},
            {term: {"properties.FULLNAME": data.STREET_NAME_POST_TYPE.toLowerCase()}}
          ],
          filter: {
            bool: {
              should: [
                {
                  bool: {
                    must: [
                      {
                        bool: {
                          should: [
                            {range: {"properties.LFROMHN": {lte: data.ADDRESS_NUMBER}}},
                            {range: {"properties.RFROMHN": {lte: data.ADDRESS_NUMBER}}}
                          ]
                        }
                      },
                      {
                        bool: {
                          should: [
                            {range: {"properties.LTOHN": {gte: data.ADDRESS_NUMBER}}},
                            {range: {"properties.RTOHN": {gte: data.ADDRESS_NUMBER}}}
                          ]
                        }
                      }
                    ]
                  }
                },
                {
                  bool: {
                    must: [
                      {
                        bool: {
                          should: [
                            {range: {"properties.LFROMHN": {gte: data.ADDRESS_NUMBER}}},
                            {range: {"properties.RFROMHN": {gte: data.ADDRESS_NUMBER}}}
                          ]
                        }
                      },
                      {
                        bool: {
                          should: [
                            {range: {"properties.LTOHN": {lte: data.ADDRESS_NUMBER}}},
                            {range: {"properties.RTOHN": {lte: data.ADDRESS_NUMBER}}}
                          ]
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    };

    data.STREET_NAME.split(" ").forEach(function(s) {
      esBodyPoint.query.bool.must.push({term: {"properties.street": s.toLowerCase()}});
      esBodyCensus.query.bool.must.push({term: {"properties.FULLNAME": s.toLowerCase()}});
    });

    var esBody = esBodyPoint;
    if (geocodeType === "census") {
      esBody = esBodyCensus;
    }

    // Currently running against docker-machine endpoint
    var reqUrl = "http://192.168.99.100:9200/" + searchIndex + "/_search";

    var reqOptions = {
      url: reqUrl,
      method: 'POST',
      body: JSON.stringify(esBody)
    };

    request(reqOptions, function (err, res, body) {

      if (err || res.statusCode !== 200) {
        self.push(addErrorData(data, (err ? err.message : res.statusMessage)));
        inFlightCount--;
        return;
      }
      var resData = JSON.parse(body).hits.hits;

      if (resData.length === 0) {
        self.push(addErrorData(data, '0 results'));
        inFlightCount--;
        return;
      }

      self.push(addResData(data, resData, geocodeType));
      inFlightCount--;
    });

    // Make rate limit more for just not crashing Elasticsearch
    setTimeout(function () {
      next(null);
    }, 100);

  },
  // don't flush the stream until the last in flight request has been handled
  function (done) {
    var interval = setInterval(function () {
      if (inFlightCount === 0) {
        clearInterval(interval);
        done();
      }
    }, 100);
  });
}

// Processing ADDRFEAT ranges
function handleCensusRanges(rangeFrom, rangeTo) {
  var fromInt = null;
  var toInt = null;
  if (rangeFrom !== null) {
    var fromInt = !isNaN(rangeFrom) ? parseInt(rangeFrom) : 0;
  }
  if (rangeTo !== null) {
    var toInt = !isNaN(rangeTo) ? parseInt(rangeTo) : 0;
  }

  var rangeIsEven = (fromInt % 2 === 0) && (toInt % 2 === 0);

  // Accounting for some from's being greater than to's
  if (fromInt > toInt) {
    var rangeDiff = fromInt - toInt;
  }
  else {
    var rangeDiff = toInt - fromInt;
  }

  return {
    isEven: rangeIsEven,
    fromInt: fromInt,
    toInt: toInt,
    rangeDiff: rangeDiff
  };
}

// Interpolating TIGER address data
function interpolateCensus(data, resData) {
  var tigerFeat = resData._source;
  var lineDist = turfLineDistance(tigerFeat, 'miles');

  var addrInt = parseInt(data.ADDRESS_NUMBER);
  var addrIsEven = addrInt % 2 === 0;

  var lRange = handleCensusRanges(tigerFeat.properties.LFROMHN, tigerFeat.properties.LTOHN);
  var rRange = handleCensusRanges(tigerFeat.properties.RFROMHN, tigerFeat.properties.RTOHN);

  if (addrIsEven === lRange.isEven) {
    var range = lRange;
  }
  else if (addrIsEven === rRange.isEven) {
    var range = rRange;
  }
  else {
    return addErrorData(data, 'Interpolation failed');
  }

  // Getting point along line at ratio, accounting for some from's being greater than to's
  if (range.fromInt > range.toInt) {
    var rangeDist = ((range.fromInt - addrInt) / range.rangeDiff) * lineDist;
  }
  else {
    var rangeDist = ((addrInt - range.fromInt) / range.rangeDiff) * lineDist;
  }
  try {
    var alongPt = turfAlong(tigerFeat, rangeDist, 'miles');
  }
  catch(err) {
    return addErrorData(data, 'Error in along calculation');
  }


  var propData = tigerFeat.properties;
  var labelStr = propData.FULLNAME + " " + propData.LFROMHN + "-" + propData.LTOHN + " " + propData.RFROMHN + "-" + propData.RTOHN;

  data.res_longitude = alongPt.geometry.coordinates[0];
  data.res_latitude = alongPt.geometry.coordinates[1];
  data.res_confidence = resData._score;
  data.res_label = labelStr;
  return data;
}

function addErrorData(data, message) {
  data.res_longitude = '';
  data.res_latitude = '';
  data.res_confidence = '';
  data.res_label = 'ERROR: ' + message;
  return data;
}

function addResData(data, resData, geocodeType) {
  if (geocodeType === "census") {
    return interpolateCensus(data, resData[0]);
  }

  data.res_longitude = resData[0]._source.geometry.coordinates[0];
  data.res_latitude = resData[0]._source.geometry.coordinates[1];
  data.res_confidence = resData[0]._score;
  data.res_label = resData[0]._source.properties.address;
  return data;
}

module.exports = createSearchStream;
