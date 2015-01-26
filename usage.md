#Usage
```

var stateflow = require('stateflow');
// Create a flow with flow defintion (see jsdoc)
var flow = new stateflow.StateFlow({
	'entry-state' : {
		type:'begin',
		action: function(complete) {
			this.someData = 'myData'; // <-- every state has an State object assigned to action this
			complete('ignoredEvent');
			complete('myEvent'); // the state is over
		},
		on: {
			'myEvent':'other-state'
		}
	},
	'other-state': {
		action: function(complete) { // can also be a flow definition (subflow).
			this.get('myServiceOrData'); // <-- private field or inherented from parent flow
			this.listenTo('myServiceOrData','event', 'signalEvent'); // <-- event listener which cancelled after completion, can also be a listener function
			this.installTimeout(5000, 'timeout'); // <!-- state timeout which is cancelled after completion, can also be a function
			
		},
		on: {
			'timeout':'exit-state',
			'signalEvent':'named-action-state'
		}
	},
	'named-action-state': {
		action:'myAction', //<-- register with registerAction(name, action), useful for json definition or generic action's
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
