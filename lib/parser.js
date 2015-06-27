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
var parse = function(src, loader) { // we might need caching

        var obj = {}, parserResult = parser.parse(src);
        // Figure out if i can move this to the parser, because i want to reuse this logic
        // Can also register this as a util function to the parser
        parserResult.forEach(function (row) {
            if (row.type === 'event') {
                getState(obj, row.from).on[row.on] = row.to;
            } else if (row.type === 'property') {
                if (row.property === 'action' && row.value.indexOf('@') === 0 && typeof loader === 'function') {
                    // action starts with @, then we load the subflow
                    getState(obj, row.state)[row.property] = parse(loader(row.value.substring(1)));
                } else {
                    getState(obj, row.state)[row.property] = row.value;
                }

            } else if (row.type === 'function') {
                // this is really cool!, only real downside is the parser might throw unclear errors when the blocks are not balanced!
                /*jslint evil: true */
                getState(obj, row.state)[row.property] = new Function(['complete'], row.body);
            }
        });

    return obj;
};
module.exports = parse;