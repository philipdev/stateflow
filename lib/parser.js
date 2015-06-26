/*jslint node: true */
'use strict';
var peg = require('pegjs');
var fs = require('fs');


var parser = peg.buildParser(fs.readFileSync(__dirname +"/parser.txt", "utf8"));

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
    parserResult.forEach(function(row) {
        if(row[0] === 'event') {
            getState(obj, row[1]).on[row[2]] = row[3];
        } else  if(row[0] === 'property'){
            if(row[2] === 'action' && row[3].indexOf('@') === 0 && typeof loader === 'function' ) {
                // action starts with @, then we load the subflow
                getState(obj, row[1])[row[2]] = parse(loader(row[3].substring(1)));
            } else {
                getState(obj, row[1])[row[2]] = row[3];
            }
            
        } else if(row[0] === 'function') {
            // this is really cool!, only real downside is the parser might throw unclear errors when the blocks are not balanced!
            /*jslint evil: true */
            getState(obj, row[1])[row[2]] = new Function(['complete'], row[3]);
        }
    });
    
    return obj;
};
module.exports = parse;