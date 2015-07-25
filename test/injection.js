/**
 * Created by Philip Van Bogaert on 25-7-2015.
 * Another cool feature, if the state config has a property argumentNames (array of strings), then all these names are looked up using stateObj.get() and provided to
 * the action as arguments.
 *
 * This feature is also supported in the flow action
 * e.g: myState.action(myService, otherService) { // will inject these and make them available under the same name
 *  // e.g:
 *  myService.doSomething()
 * }
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

describe('DI', function () {

    it('dependency injection ', function (done) {
        var flow = create('inject.flow');
        flow.set('a', new EventEmitter());
        flow.set('b', new EventEmitter());
        flow.set('c', new EventEmitter());

        flow.start(function (event, error) {
            try {
                if(event === 'error') {
                    assert.fail('Got error:' + error);
                }
                assert.equal(event, 'end');
                done();
            } catch (e) {
                done(e);
            }
        });
    });
});