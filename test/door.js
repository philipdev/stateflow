/*jslint node: true */
/*global describe, it*/
'use strict';
var assert = require('assert');
var util = require('util');
var StateFlow = require('../lib/stateflow').StateFlow;
var EventEmitter = require('events').EventEmitter;

function Door(status,lockStatus) {
    this.status = status;
    this.lockStatus = lockStatus;
}
util.inherits(Door, EventEmitter);
Door.prototype.setStatus = function (status) {
    this.status = status;
    this.emit(status);
};

Door.prototype.setLockStatus = function (status) {
    this.lockStatus = status;
    this.emit(status);
};

Door.prototype.changeStatus = function (status, cb) {
    var self = this;
    setTimeout(function() {
        self.setStatus(status);
        if(cb) {
            cb(null, self.status);
        }
    },500);
};

Door.prototype.changeLockStatus = function (status, cb) {
    var self = this;
    setTimeout(function() {
        self.setLockStatus(status);
        if(cb) {
            cb(null, self.lockStatus);
        }
    },500);
};

Door.prototype.open = function (cb) {
    if(this.status === 'closed' && this.lockStatus === 'unlocked') {
        this.setStatus('openeing');
        this.changeStatus('open', cb);
    } else {
        console.trace('Can not open door');
        cb(new Error('Can not open door'));
    }
};

Door.prototype.close = function(cb) {
    if(this.status ==='open' && this.lockStatus ==='unlocked') {
        this.setStatus('closing');
        this.changeStatus('closed', cb);
    } else {
        console.trace('Can not close door');
        cb(new Error('Can not close door'));
    }
};

Door.prototype.lock = function(cb) {
    if(this.lockStatus === 'unlocked' && this.status !== 'opening' && this.status !== 'closing' ) {
        this.setLockStatus('locking');
        this.changeLockStatus('locked');
    } else {
        console.trace('Can not lock door');
        cb(new Error('Can not lock door'));
    }
};

Door.prototype.unlock = function(cb) {
    if(this.lockStatus === 'locked' && this.status !== 'opening' && this.status !== 'closing') {
        this.setLockStatus('unlocking');
        this.changeLockStatus('unlocked');
    } else {
        console.trace('Can not unlock door');
        cb(new Error('Can not unlock door'));
    }
};



describe('Door', function () {
    var openDoorDef = {
        'begin': {
            type: 'begin',
            action: function(complete){
                console.error('begin');
                var door = this.get('door'); 
                if(door.status === 'open' || door.status === 'opening') {
                    complete('done');
                } else if(door.lockStatus === 'locked' || door.lockStatus === 'locking') {
                    complete('unlock');
                } 
            },
            on: {
                'unlock':'unlockDoor',
                'open':'openDoor',
                'done':'success',
                '*':'failed'
            }
        },
        'unlockDoor': {
            action: function (complete) {
                console.error('unlockDoor');
                var door = this.get('door');
                //this.installTimeout(1000, 'timeout');
                function unlock() {
                    door.unlock( function (error) {
                        if(error) {
                            console.trace('unlock error');
                            complete('error');
                        }
                    });
                }
                if(door.lockStatus === 'locked') {
                    unlock();
                } 
                this.onStateActive(door, 'locked', unlock); 
                this.onStateActive(door, 'unlocked', 'unlocked');
            },
            on: {
                'unlocked':'openDoor',
                '*':'failed'
            }
        },
        'openDoor' : {
            
            action: function (complete) {
                console.error('openDoor');
                var door = this.get('door');
                function open() {
                    door.open(function (error) {
                        if(error) {
                            console.trace('openDoor', 'door open failed!', error);
                            complete(error);
                        }
                    });
                }
                if(door.status === 'open') {
                    complete('doorOpen');
                } else if(door.lockStatus === 'locked' || door.lockStatus === 'locking') {
                    console.trace('openDoor', 'door still locked!');
                    complete('error');
                } else {
                    if(door.status === 'closed') {
                        open();
                    }
                    this.onStateActive(door,'closed', open);
                    this.onStateActive(door,'unlocked', open);
                    this.onStateActive(door,'open');
                }
            }, 
            on: {
                'open':'success',
                '*':'failed'
            }
        },
        'success' : {
            type: 'end',
            action: function (complete) {
                
                var door = this.get('door');
                if(door.status ==='open') {
                    complete('doorOpen');
                }
                this.onStateActive('door', 'open', 'doorOpen');
            }
        },
        'failed' : {
            type:'end',
            action: function (complete) {
                complete('error');
            }
        }
    };   
    
    describe('open door', function () {
        it('door is closed and locked', function (done) {
            
            
            var door = new Door('closed','locked');
            function logStatus () {
                console.log('door', door.status, door.lockStatus);
            }
            door.on('open', logStatus);
            door.on('opening', logStatus);
            door.on('closing', logStatus);
            door.on('closed', logStatus);
            door.on('locked', logStatus);
            door.on('unlocked', logStatus);
            door.on('unlocking', logStatus);
            door.on('locking', logStatus);
            
            var flow = new StateFlow(openDoorDef);
            flow.set('door',door);
            flow.start(function (event) {
                assert.equal('doorOpen', event);
                done();
            });
        });
        
        
        
        
    });
});
    