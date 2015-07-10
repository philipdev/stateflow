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
                next('done');

            });
            flow.start(function (event) {
                assert.equal('done', event);


                flow.on('state:nextState', function () {
                 //   console.trace('nextState');
                    done();
                });

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
                assert.equal('myDataFuncValue', this.get('myDataFunc')());
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
                assert.equal('myDataFuncValue', this.get('myDataFunc')());
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
                this.installTimeout(100); // reinstall,TIMEOUT
                this.installTimeout(); // reinstall in 100ms, TIMEOUT
            });
            flow.start(function (event) {
                assert.equal('TIMEOUT', event);
            });
            setTimeout(function () {
                done();
            }, 250);
        });

        it('onStateActive, listens only when active, completion event when listener is a string', function (done) {
            var flow = new StateFlow(flowDefinition), emitter = new EventEmitter();

            flow.set('emitter', emitter);
            flow.registerAction('endAction', function () {
                assert.equal(emitter, this.get('emitter'));
                this.onStateActive('emitter', 'event', function () { // function listener
                    process.nextTick(function () {
                        emitter.emit('nextEvent');
                    });
                });
                this.onStateActive('emitter', 'nextEvent', 'ended'); // completion event listener
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
                        'myService.myEvent': 'nextState'
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
        it('initialize and destroy must be called on flow entry and exit', function (done) {
            var counter = 0;
            var deinitCounter = 0;
            var myFlowDefinition = {
                beginState: {
                    type: 'begin',
                    initialize: function () {
                        counter++;
                    },
                    destroy: function () {
                        deinitCounter++;
                    },
                    action: function (complete) {
                        this.get('service').emit('continue');
                    },
                    on: {
                        'service.continue': 'nextState'
                    }
                },
                nextState: {
                    type: 'end',
                    action: function (cb) {
                        cb('done');
                    }
                }
            };
            var flow = new StateFlow(myFlowDefinition), emitter = new EventEmitter();
            flow.set('service', emitter);

            flow.start(function () {
                assert.equal(counter, 1);
                assert.equal(deinitCounter, 1);
                done();
            });
        });

        it('State events must also trigger state on match', function (done) {
            var myFlowDefinition = {
                beginState: {
                    type: 'begin',
                    action: function () {
                        // does nothing, should this be the default action?
                        this.emit('myEvent');
                    },
                    on: {
                        'myEvent': 'nextState'
                    }
                },
                nextState: {
                    type: 'end',
                    action: function (cb) {
                        //cb('done');
                        this.emit('done');
                    },
                    on: {
                        'done':'newEvent'
                    }
                }
            };

            var flow = new StateFlow(myFlowDefinition);
            flow.on('flow:exit', function(event) {
                assert.equal('newEvent', event);
                done();
            }); // want use the same entry, exit event names for both state flow

            flow.start();
        });

    });
});