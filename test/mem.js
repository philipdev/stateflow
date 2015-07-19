/**
 * Created by Philip Van Bogaert on 19-7-2015.
 */
var stateflow = require('../lib/stateflow');
var EventEmitter = require('events').EventEmitter;

var fs = require('fs');
var assert = require('assert');

function loader(resource, cb) {
    fs.readFile(__dirname +'/flows/' + resource, 'utf8', cb);
}
describe('StateFlow special cases', function () {
    it('loop', function (done) {
        stateflow.load('loop.flow', loader, function (err, flow) {
            flow.set('emitter', new EventEmitter());
            flow.on('stateChanged', function(newState,oldState) {
               console.error('stateChanged', oldState,'->', newState);

            });
            var count = 1;
            flow.on('state:next', function(state) {
                //console.log('next state count:', flow.states['next'].count);
                console.error('count',count);
                //assert.equal(state.count, count );
                count+=1;
            });

            flow.on('state:end', function() {
               //assert.equal(this.states['next'].count, 10);
            });
            if (err) {
                done(err);
            } else {
                flow.on('error', function(e) {
                    done(e);
                });
                flow.start(function(event) { // TODO: error in start handler

                    try {
                        assert.equal('ended', event);
                        assert.equal(10, this.states['next'].count);
                        //assert.equal(flow.getStateObject('loop').count);
                        done();
                    } catch(e) {
                        console.error(e);
                        done(e);
                    }
                });

            }
        });
    });
});