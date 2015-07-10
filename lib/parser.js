/*jslint node: true */
'use strict';
var peg = require('pegjs');
var fs = require('fs');


//var parser = peg.buildParser(fs.readFileSync(__dirname +"/parser.txt", "utf8"));
var parser = require('./generatedParser.js'); // browserify friendly

function getState(flow, name) {
    if(!flow[name]) {
        flow[name] = {
            on : {}
        };
    }
    
    return flow[name];
}

/**
 * Creates a flow definition object from a simple flow language which can be passed to the StateFlow constructor
 */
var parse = function(src) { // we might need caching

        var obj = {}, parserResult = parser.parse(src);
        // Figure out if i can move this to the parser, because i want to reuse this logic
        // Can also register this as a util function to the parser
        parserResult.forEach(function (row) {
            if (row.type === 'event') {
                getState(obj, row.from).on[row.on] = row.to;
            } else if (row.type === 'property') {
                getState(obj, row.state)[row.property] = row.value;
            } else if (row.type === 'function') {
                // this is really cool!, only real downside is the parser might throw unclear errors when the blocks are not balanced!
                /*jslint evil: true */
                getState(obj, row.state)[row.property] = new Function(['complete'], row.body);
            }
        });

    return obj;
};

function loadSubs(flowConfig, loader, remaining, cb) {
    if(remaining.length > 0) {
        var state = flowConfig[remaining.shift()];
        var resource = state.action.substring(1);
        load(resource, loader, function(err, config) {
            if(err) {
                cb(err);
            } else {
                state.action = config;
                loadSubs(flowConfig, loader, remaining, cb); // aka next
            }
        });
    } else {
        cb(undefined, flowConfig);
    }
}
var load = function(resource, loader, cb) {
    loader(resource, function(err, result){
        if(err) {
            cb(err);
        } else {
            var flowConfig = parse(result);
            var remaining = Object.keys(flowConfig).filter(function (stateName) {
                return typeof this[stateName].action === 'string' && this[stateName].action.indexOf('@') === 0;
            }, flowConfig);
            loadSubs(flowConfig, loader, remaining, cb);
        }
    });
};

module.exports = parse;
module.exports.load = load;
