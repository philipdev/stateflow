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


    it('error: with on handler, must stay current', function(done) {
        var flow = create('errorNoHandler.flow');
        flow.set('extern', new EventEmitter());
        flow.on('error', function(error) {
            try {
                assert.equal(error.message, 'error no handler');
                assert.equal(flow.currentState, 'noHandler');

                flow.get('extern').emit('next');
            } catch(e) {
                done(e);
            }
        });

        flow.start(function(event) {
            try {
                assert.equal(event, 'end');
                done();
            } catch(e) {
                done(e);
            }
        });
    });

    it('state catches own error', function(done) {
        var flow = create('catchOwnError.flow');
        flow.start(function (event, error) {
            assert.equal(event,'end');
            assert.equal(error, undefined);
            done();
        });
    });
    it('error: with handler must continue', function(done) {
        var flow = create('errorWithHandler.flow');

        flow.start(function(event) {
            assert.equal(event, 'end');
            done();
        });
    });

    it('error:  no handler, no listener  must exit with error', function(done) {
        var flow = create('errorNoHandler.flow'), exitEvent = false;
        flow.addStateDecorator(function(state) {
            if(state.name === 'noHandler') {
                console.log('adding noHandler exit event handler');
                state.on('exit', function(target, event, args){
                     try {
                         assert.equal(event, 'error');
                         assert.equal(args.length,  1, 'exit event error must have one argument');
                         assert.equal(args[0].message, 'error no handler','the argument must be the error thrown');
                         exitEvent = true;
                     } catch(e) {
                         done(e);
                    }
                });
            }
        });
        flow.start(
            function(event, error) {
                try {
                    assert(exitEvent, 'exit event must always fired!');
                    assert.equal(event, 'error');
                    assert.equal(error.message, 'error no handler');
                    done();
                } catch(e) {
                    done(e);
                }
            }
        );

        // flow.destroy();
    });

});