/*jslint node: true */
/*global describe, it*/
'use strict';
var assert = require('assert');
var StateFlow = require('../lib/stateflow').StateFlow;
var EventEmitter = require('events').EventEmitter;

function createAction(event, waitFor) {
    return function (complete) {
        if (waitFor) {
            waitFor.once('continue', function (data) {
                console.log('continue');
                complete(data);
            });
            waitFor.emit(event);
        } else {
            complete(event);
        }
    };
}
describe('StateFlow subflows', function () {
    describe('embedded', function () {
        var def = require('./flows/embedded.json');
        it('happy flow ;-)', function (done) {
            var flow = new StateFlow(def);
            flow.registerAction('someAction', createAction('ok'));
            flow.registerAction('start', createAction('next'));
            flow.start(function (endEvent) {
                assert.equal('ok', endEvent);
                done();
            });
        });
    });
    describe('flow which has a action defined as subflow', function () {
        var def = require('./flows/subflowAction.json');
        it('happy flow', function (done) {
            var flow = new StateFlow(def), emitter = new EventEmitter();
            flow.registerAction('subflow', require('./flows/sample.json'));
            flow.registerAction('ok', createAction('ok'));
            flow.registerAction('wait', createAction('wait', emitter));
            flow.set('param', 'value');
            emitter.once('wait', function () {
                assert.equal('subflow', flow.currentState);
                assert.equal('begin-state', flow.getStateObject('subflow').currentState);
                assert(flow.getStateObject('subflow').active, 'subflow must be active');
                assert(flow.getStateObject('subflow').getStateObject('begin-state').active, 'subflow.begin-state must be active');
                assert('value', flow.getStateObject('subflow').getStateObject('begin-state').get('param'), 'state must inheret data from super flow');
                
                emitter.once('wait', function () {
                    emitter.emit('continue', 'ok');
                });
                
                emitter.emit('continue', 'again');
            });
            
            
            
            flow.start(function (event) {
                assert.equal('ok', event);
                done();
            });
        });
    });
});