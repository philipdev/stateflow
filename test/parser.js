/*jslint node: true */
/*global describe, it*/
'use strict';
var assert = require('assert');
var fs = require('fs');
var parser = require('../lib/parser');
var stateflow = require('../lib/stateflow');
var EventEmitter = require('events').EventEmitter;

describe('parse simple', function () {
   var script =  "// parser\n" + 
   "step-a.done -> step-b \n" +
   "step-a.type =begin \n" +
   "step-a.number = 999; // test \n" +
   "step-a.text = '999'; step-a.bool = true \n" +
   "step-a.action = namedAction \n" +
   "step-b['ok'] -> 'step-c'; \n" +
   "step-b.action { if('step-b' !== this.name) throw 'invalid name'; this.installTimeout(100, 'ok');} \n" +
   "step-c.action = otherNamedAction \n" +
   "step-c.type='end';\n\n\n";
   
   var flow = parser(script);


   it('check flow config object', function() {
       //console.log(flow);
       assert.equal('step-b', flow['step-a'].on.done);
       assert.equal('begin', flow['step-a'].type);
       assert.equal('namedAction', flow['step-a'].action);
       assert.equal(999, flow['step-a'].number);
       assert.equal("999", flow['step-a'].text);
       assert.equal(true, flow['step-a'].bool);
       assert.equal('step-c', flow['step-b'].on.ok);
       assert.equal('function', typeof flow['step-b'].action);
       assert.equal('otherNamedAction', flow['step-c'].action);
       assert.equal('end', flow['step-c'].type);
   });
    it('parse empty string must return an empty object', function() {
        var result = parser('');
        assert.deepEqual({}, result);
    });

    it('parse whitespace string must return an empty object', function() {
        var result = parser('\n\n\n');
        assert.deepEqual({}, result);
    });

   it('run the flow', function(done) {
       var flow = stateflow.create(script);
       flow.registerAction('namedAction', function(complete) {
            assert.equal(999, this.config.number);
            complete('done');    
       });
       flow.registerAction('otherNamedAction', function(complete) {
           complete('done');    
       });
       flow.start(function(event) {
           assert.equal('done', event);
           done();
       });
   });

    it('run external flow', function(done) {
        var flow = stateflow.create(fs.readFileSync(__dirname +'/flows/simple.flow', 'utf8'));
        flow.set('myService', new EventEmitter());


        flow.start(function(event) {
            assert.equal('finish', event);
            done();
        });

    });
    it('run noAction flow', function(done) {
        var flow = stateflow.create(fs.readFileSync(__dirname +'/flows/noAction.flow', 'utf8'));
        var service = new EventEmitter();
        flow.set('service', service);


        flow.start(function(event) {
            assert.equal('finish', event);
            done();
        });
        flow.on('state:start', function() {
            service.emit('next');
        });
    });

    function loader(resource, cb) {
        fs.readFile(__dirname +'/flows/' + resource, 'utf8', cb);
    }

    it('load flow with subflow', function(done) {
        parser.load('withSubflow.flow', loader, function(err, config) {
            if(err) {
                done(err);
            } else {
                assert(typeof config === 'object');
                console.log(config.state.action);
                assert(typeof config.state.action ==='object');
                done();
            }
        });

    });
});