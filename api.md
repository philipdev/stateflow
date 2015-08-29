## Install
`npm install stateflow --save`

## Module
`var stateflow = require('stateflow');`


## JavaScript object notation
```
{
   <stateName>: {
	   initialize: <function>,
	   destroy: <function>, 
	   action: <function> | <namedAction> | <js subflow object>	
       on: {
			<event|service.event>:'<nextState>', ...
	   }
	   ... other properties
   }
}
```
 		
## Simple stateflow language notation

A stateflow consists of zero or more statement a statement is terminated either by a newline or semicolon (;) .

Transitions are statements defined in the format state.eventName -> targetStateName.

`state.event -> target`

Every of 3 different names may also be enclosed in single or double quotes, this is for example needed if you need to create a transition on a service which is delimited by a dot
and which is not allowed in a literal string.

`state.'myService.event' -> next`

State properties is a statement defined in the format stateName.propertyName = value
```
	state.number = 9.9
	state.action = namedAction
	state.specialString = '!!! extra !!!'
	state.flag = true
```	
The action property is the action to be executed when the state becomes active.

The type property is to specify whether a state is a begin, end or regular state is, and must be set for begin and end states.

The state maybe be a quoted or a literal string, the property may be a quoted, literal string or number, the value may be a quoted, literal string, number or boolean.

State function property is a statement defined in the format state.property { }, general used to define actions


The state and property have the same restrictions as a regular State property then curly brackets enclose a JavaScript function body and are generally used to implement state actions.
```
	state.action {
		this.emit('event');
	}
```

Actions function can also be injected with one or more services (equivalent of flow.get('<SERVICE>') as named arguments.
```
	state.action(myService) { // service was set via flow.set('myService', service)
		myService.someMethod();
		this.emit('event');
	}
```

A literal string is string without quotes out following characters of 0-9, a-Z, @, -, _  

A literal number a number can have any digit, minus sign and a dot (.)

A literal boolean a boolean can be either *true* or *false*

Quoted strings can have any characters except the the quotes which it was enclosed in.

## Create a flow
Use `var flow = new stateflow.StateFlow(obj);` to create a flow with js object nation.

Use `var flow = stateflow.create(flowLanguage)` to create a flow with the flow language

Use `stateflow.load(name, loader, loadedCallback)` to load a flow from a resource and subflows (named action which start with the @ sign).
* loader signature: function(resource, resultCallback) where the signature of the resultCallback is function(err, sourceText)
* loadedCallback: signature: function(err, flow)

## Error handling
When an error has been thrown in action, timeout handler, onStateActive handler or onFlowActive handler.
 
1. There is state error event listener ( state.on('error', listener) ) the error is emitted to the state
2. If there was no error event listener and there is an error event transition mapping (aka `state.error-> other` OR `state: { on:{ error:'other'} }` ), the flow continues to that state.
3. There was no error event listener and no error mapping then the flow ends with 'error' and the error object.


## State 
State extends EventEmitter.
### Methods

#### get(name)
Get a service from the current state or parent(s), bottom up.

#### set(name, service)
Set a service

#### onStateActive(service, event, listener) 
Listen for events on the service (name or object) while the state is active (aka automatically removed when the state exits)

* service: name or service object
* event: event to listen for
* listener: listener function or event string to fire

#### onFlowActive(service, event, listener) 
Listen for events on the service (name or object) while the flow is running
* service : name or service object
* event : event to listen for
* listener: listener function or event string to fire

#### installTimeout(timeout, listener) 
Install a state timeout
* timeout: timeout in millseconds (if omitted the last one before cancelTimeout() is called
* listener: listener  function or event to fire on timeout, if omitted then the last is used after the last cancelTimeout()

#### cancelTimeout() 
Cancel a previously installed timeout, always executed on state exit

#### stateComplete(event)
Try to complete the current state with the specified event.

### Properties
* active - true or false indicating if the state is active
* config - the js object definition of the state
* parent - the parent flow.

### Events
* entry
* exit
* an errorCode - when an exception thrown by the state action, will try to complete the state with the *code* property of the error (if exists).
* exception - when exception was thrown in the state action and no handler was found with then the exception event is emitted, if there is no handler for that then the error is emitted on the flow.

## StateFlow
StateFlow extends State
### Methods
#### start(callback)
Execute the flow and call the callback when finished. the event is passed as first argument.
* callback signature function(event) 

#### getStateObject(statName)
Get the state instance object

#### registerAction(name, action, initializer, destructor)
Register an action which can be referenced by state action defined as string
* name is a string
* action can be a function or a js object subflow, initializer and destructors are optional functions.
* intializer is a function called when the flow starts (optional)
* destructor is a function called when the flow exits (optional)

#### addStateDecorator(callback)
Add state decorator which is called just after a state or subflow is created, used to add methods and properties to states,
a subflow inherent all decorators from it's parent flow.
 
* callback signature: function(state)

### Properties
* currentState

### Events
* stateChanged - triggered on any state change
* state:stateName - triggered on specific state change where the stateName specify which.
* flow:entry
* flow:exit
* error

## Browser

There is also a browserify version available.

 * Include browser/stateflow.js
 * Use `new stateflow.StateFlow(config)` or `stateflow.create(source)` to create a flow
