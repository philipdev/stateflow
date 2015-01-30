/*jslint node: true */
/*global describe, it*/
'use strict';
var assert = require('assert');
var StateFlow = require('../lib/stateflow').StateFlow;
var EventEmitter = require('events').EventEmitter;

describe('StateFlow', function () {
    describe('simple flow definition', function () {
        var flowDefinition = {
            beginState: {
                type: 'begin',
                action: function (complete) {
                    complete('anEvent');
                },
                on: {
                    anEvent: 'nextState'
                }
            },
            nextState: {
                type: 'end',
                action: 'endAction'
            }
        };

        it('flow must end with done event', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function () {
                this.stateComplete('done');
            });
            flow.start(function (event) {
                assert.equal('done', event);
                done();
            });
        });

        it('flow must signal state:beginState', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function () {
                this.stateComplete('done');
            });
            flow.on('state:beginState', done);
            flow.start(function (event) {
                assert.equal('done', event);
            });
        });

        it('flow must signal state:nextState', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function () {
                this.stateComplete('done');
            });
            flow.on('state:nextState', done);
            flow.start(function (event) {
                assert.equal('done', event);
            });
        });

        it('flow must signal state:nextState even when the state is already currentState', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function (next) {
                flow.on('state:nextState', function () {
                    next('done');
                    done();
                });
            });
            flow.start(function (event) {
                assert.equal('done', event);
            });
        });

        it('flow get flow data', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.set('myData', 'myDataValue');
            flow.set('myDataFunc', function () {
                return 'myDataFuncValue';
            });
            flow.registerAction('endAction', function () {
                assert.equal('myDataValue', this.get('myData'));
                assert.equal('myDataFuncValue', this.get('myDataFunc'));
                done();
                this.stateComplete('done');
            });
            flow.start(function (event) {
                assert.equal('done', event);
            });
        });

        it('flow get flow data', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.set('myData', 'myDataValue');
            flow.set('myDataFunc', function () {
                return 'myDataFuncValue';
            });
            flow.registerAction('endAction', function () {
                assert.equal('myDataValue', this.get('myData'));
                assert.equal('myDataFuncValue', this.get('myDataFunc'));
                this.stateComplete('done');
            });
            flow.start(function (event) {
                assert.equal('done', event);
                done();
            });
        });

        it('timeout function', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function () {
                this.installTimeout(120, function () {
                    assert.fail('Must be cancelled!');
                });
                this.installTimeout(100, function () { // timeout function
                    this.installTimeout(100, 'TIMEOUT'); // timeout state-end event
                });
            });
            flow.start(function (event) {
                assert.equal('TIMEOUT', event);
                done();
            });
        });

        it('timeout event', function (done) {
            var flow = new StateFlow(flowDefinition);
            flow.registerAction('endAction', function () {
                assert(this.parent === flow); // random test
                this.installTimeout(100, 'TIMEOUT');
            });
            flow.start(function (event) {
                assert.equal('TIMEOUT', event);
            });
            setTimeout(function () {
                done();
            }, 250);
        });

        it('listenTo, listens only when active, completion event when listener is a string', function (done) {
            var flow = new StateFlow(flowDefinition), emitter = new EventEmitter();
            flow.set('emitter', emitter);
            flow.registerAction('endAction', function () {
                assert.equal(emitter, this.get('emitter'));
                this.listenTo('emitter', 'event', function () { // function listener
                    process.nextTick(function () {
                        emitter.emit('nextEvent');
                    });
                });
                this.listenTo('emitter', 'nextEvent', 'ended'); // completion event listener
            });
            flow.start(function (event) {
                assert.equal('ended', event);
            });

            emitter.on('removeListener', function (event) {
                if (event === 'event') {
                    done();
                }
            });

            emitter.emit('event');
            emitter.emit('event'); // this must be ignored!
        });
        
        it('Forward service events', function (done) {
            var myFlowDefinition = {
                beginState: {
                    type: 'begin',
                    action: function (complete) {
                        // does nothing, should this be the default action?
                    },
                    on: {
                        'myService.myEvent':'nextState'
                    }
                },
                nextState: {
                    type: 'end',
                    action: function (cb) {
                        cb('done');
                    }
                }
            };

            var emitter = new EventEmitter();
            var flow = new StateFlow(myFlowDefinition);
            flow.set('myService', emitter);
            flow.start(function (event) {
                assert.equal('done', event);
                done();
            });

            emitter.emit('myEvent');
            emitter.emit('myEvent'); // this must be ignored!
        });
    });
});