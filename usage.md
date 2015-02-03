# Usage

```
var stateflow = require('stateflow');
// Create a flow with flow definition (see jsdoc)
var flow = new stateflow.StateFlow({
	'entry-state' : {
		type:'begin',
		action: function() {
			this.someData = 'myData'; // <-- every state has an State object assigned to action this
			this.emit('ignoredEvent');
			this.emit('myEvent'); // the state is over
		},
		on: {
			'myEvent':'other-state'
		}
	},
	'other-state': {
		initialize: function() { },
		destroy: function() { },
		action: function() { // can also be a flow definition (subflow).
			this.get('myServiceOrData'); // <-- private field or inherented from parent flow
			this.onStateActive('myServiceOrData','event', 'signalEvent'); // <-- event listener, cancelled on exit
			this.installTimeout(5000, 'timeout'); // <!-- emits: timeout after 5000ms (if state still active)
		},
		on: {
			'timeout':'exit-state',
			'signalEvent':'named-action-state'
		}
	},
	'named-action-state': {
		action:'myAction', // before: flow.registerAction('myAction', action)
		on: {
			'done':'exit-state',
			'loop':'named-action-state'
		}
	},
	'exit-state' : {
		type: 'end',
		action: function(complete) {
			complete('exitEvent');
		}
	}
});

flow.set('myServiceOrData', emitter);
flow.registerAction('myAction', function(complete) { // register action can also be flow definition (subflow)
	complete('done');
});
flow.start( function completionCallback(event) {
	console.log('State finished');
});
```
