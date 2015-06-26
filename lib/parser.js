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
module.exports.parse = function(src, loader) { // we might need caching
    var obj = {}, parserResult = parser.parse(src);
    
    parserResult.forEach(function(row) {
        if(row[0] === 'event') {
            getState(obj, row[1]).on[row[2]] = row[3];
        } else  if(row[0] === 'property'){
            if(row[2] === 'action' && row[3].indexOf('@') === 0 ) {
                // action starts with @, then we load the subflow
                getState(obj, row[1])[row[2]] = module.exports.parse(loader(row[3].substring(1));
            } else {
                getState(obj, row[1])[row[2]] = row[3];
            }
            
        } else if(row[0] === 'function') {
            // this is really cool!, only real downside is the parser might throw unclear errors when the blocks are not balanced!
            getState(obj, row[1])[row[2]] = new Function(['complete'], row[3]);
        }
    });
    
    return obj;
}

var res = module.exports.parse(fs.readFileSync(__dirname + "/test.txt", "utf8"));
res['a-state'].action();
console.log(res);
