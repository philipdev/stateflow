/**
 * Created by Philip Van Bogaert on 25-7-2015.
 */
/*global describe, it*/
/*jslint node: true */
'use strict';
var assert = require('assert');
var fs = require('fs');
var parser = require('../lib/parser');
var stateflow = require('../lib/stateflow');
var EventEmitter = require('events').EventEmitter;



function create(path) {
    return stateflow.create(fs.readFileSync(__dirname +'/flows/' + path, 'utf8'));
}


describe('events in stateflow', function () {
    // exit, entry, flow:entry, flow:exit, state:<STATE>, stateChange



});