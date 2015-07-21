/*jslint node: true */
/*global describe, it*/
'use strict';
var assert = require('assert');
var fs = require('fs');
var parser = require('../lib/parser');
var stateflow = require('../lib/stateflow');
var EventEmitter = require('events').EventEmitter;

function create(path) {
    return stateflow.create(fs.readFileSync(__dirname +'/flows/' + path, 'utf8'));
}

describe('error handling', function () {
    it('exception in action without handler, must stay current', function(done) {
        var flow = create('error.flow');
        flow.on('error', function(error) {
            it('error must stay current', function(){
                assert.equal(error.message, 'error in flow');
                assert.equal(flow.currentState, 'next');
            });
            done();
        });
        flow.start();

    });

    it('exception in action with handler, must advance', function(done) {
        var flow = create('errorWithHandler.flow');
        flow.set('extern', new EventEmitter());
        var errorHandled = false;
        flow.on('error', function (e) {
            assert.equal(e.message, 'error no handler');
            flow.get('extern').emit('next');
            done();
        });


        flow.start();
        // flow.destroy();
    });
});