# Introduction
A stateflow is a collection of steps which has to be executed in a controlled order.
A step is defined as a state, a state has an action which is executed asynchronously.
The next state to go is defined as an "on" mapping either by mapping a state action completion event triggered by an execution callback or
by an event emitted from one of the registered objects.

A step/state is also a resting point, waiting for the next event/decision before going to the next state.

A flow can also be used as an action in an other flow, in this case it's a subflow where the flow end event is mapped to state completion event.

## Intention
The intention of stateflow is provide a means to implement high level processes, using a flow/state machine as a programming language often tends more complex graph than the original implementation.

## See example shopping cart flow and checkout subflow from [stateflow-example](https://github.com/philipdev/stateflow-example)
* [shopping cart flow](shopping.png)
* [checkout subflow](checkout.png)

## Use cases
* Guided user interfaces
* Build and deploy systems
* Device handling
* Implementation of workflow processes


# Usage
## Javascript
```
var stateflow = require('stateflow');
var flow = stateflow.create(fs.readFileSync('myflow.txt','utf8'));

flow.set('myService', service);
flow.registerAction('namedAction', func);

flow.start(function(event) {
	console.log('flow ended with:', event);
});

```
## Example flow a -> b -> c
```
a.type = begin
a.action (
	// regular js function body, where 'this' is the current State object
	// only the global scope, you must use flow.set('name', obj); for external services
	this.emit('ignore');
	this.emit('next'); // first matched event finishes the current state
	this.emit('next'); // ignored
}

a.next -> b
a.'service.event' -> b // does not exist in this example

b.action {
	this.installTimeout(100, 'mytimeout');
}

b.mytimeout -> c
b.other -> a

c.type = end
c.action {
	// can't use emit here, since there is no event mapping on end states.
	this.stateComplete('finish');
}
```

# Browser

There is also a browserify version available.

 * Include in browser/stateflow.js
 * Use `new stateflow.StateFlow(config)` or `stateflow.create(source)`


# Simple flow langauge

```
// Transtions
state.event -> other-state
state.otherEvent -> other-state
state.'service.event' -> other-state
// Actions
//  namedAction registered with flow.registerAction(name, func)
state.action = namedAction 
// embedded js function body, also State is bind to this here
state.action {
	// function body 
	this.emit('next');
}
// Types
// begin and end states must have a type (begin, end) 
state.type = begin
// Other properties (accessible via state.config.<propertry>)
state.bool = true
state.number = 66
// If a you need to have special characters in our string (double qoutes are also possible)
state.specialChars = '$@%@%@%'
```

# Index

**Modules**

* [stateflow](#module_stateflow)
  * [stateflow.create(flowSource, name, parent, loader)](#module_stateflow.create)
  * [callback: stateflow~action](#module_stateflow..action)
  * [callback: stateflow~completion](#module_stateflow..completion)
  * [class: stateflow~State](#module_stateflow..State)
    * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
    * [state.get(name)](#module_stateflow..State#get)
    * [state.set(name, obj)](#module_stateflow..State#set)
    * [state.onStateActive(objectOrName, event, listener)](#module_stateflow..State#onStateActive)
    * [state.onFlowActive(objectOrName, event, listener)](#module_stateflow..State#onFlowActive)
    * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
    * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)
  * [class: stateflow~StateFlow](#module_stateflow..StateFlow)
    * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
    * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
    * [stateFlow.getStateObject(state)](#module_stateflow..StateFlow#getStateObject)

**Functions**

* [parse()](#parse)

**Typedefs**

* [type: stateDefinition](#stateDefinition)
* [type: flowDefinition](#flowDefinition)
 
<a name="module_stateflow"></a>
# stateflow
**Members**

* [stateflow](#module_stateflow)
  * [stateflow.create(flowSource, name, parent, loader)](#module_stateflow.create)
  * [callback: stateflow~action](#module_stateflow..action)
  * [callback: stateflow~completion](#module_stateflow..completion)
  * [class: stateflow~State](#module_stateflow..State)
    * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
    * [state.get(name)](#module_stateflow..State#get)
    * [state.set(name, obj)](#module_stateflow..State#set)
    * [state.onStateActive(objectOrName, event, listener)](#module_stateflow..State#onStateActive)
    * [state.onFlowActive(objectOrName, event, listener)](#module_stateflow..State#onFlowActive)
    * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
    * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)
  * [class: stateflow~StateFlow](#module_stateflow..StateFlow)
    * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
    * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
    * [stateFlow.getStateObject(state)](#module_stateflow..StateFlow#getStateObject)

<a name="module_stateflow.create"></a>
## stateflow.create(flowSource, name, parent, loader)
Create a flow from a flow definition languageSyntax: state.action = myAction; // or any other property state.event -> next-state;  Also: state.property = valuevalue can be either a boolean, number or string. Quoted strings accept all characters except the quote used. a literal string only allows alpha numeric and -All actions must be registered with registerAction.

**Params**

- flowSource `string` - source text of the simple flow language  
- name `string` - flow name optional  
- parent `StateFlow` - parent flow if this is a subflow  
- loader `function` - resource loader  

<a name="module_stateflow..action"></a>
## callback: stateflow~action
State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>If defined by flow definition then start and end of the flow will be mapped to the state.

**Params**

- completion `completion` - state completion callback  

**Scope**: inner typedef of [stateflow](#module_stateflow)  
**Type**: `function`  
<a name="module_stateflow..completion"></a>
## callback: stateflow~completion
State completion callback  available as first argument of `action` or as stateComplete property of `State`.

**Params**

- event `string` - completion event  

**Scope**: inner typedef of [stateflow](#module_stateflow)  
**Type**: `function`  
<a name="module_stateflow..State"></a>
## class: stateflow~State
**Members**

* [class: stateflow~State](#module_stateflow..State)
  * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
  * [state.get(name)](#module_stateflow..State#get)
  * [state.set(name, obj)](#module_stateflow..State#set)
  * [state.onStateActive(objectOrName, event, listener)](#module_stateflow..State#onStateActive)
  * [state.onFlowActive(objectOrName, event, listener)](#module_stateflow..State#onFlowActive)
  * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
  * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)

<a name="new_module_stateflow..State"></a>
### new stateflow~State(config, name, parent)
Instance assigned to each state in a flow and bound to the action's this variable.

**Params**

- config <code>[stateDefinition](#stateDefinition)</code> - subflow definition which might contain additional properties.  
- name `string` - state name.  
- parent `StateFlow` - flow.  

**Properties**

- active `boolean` - is true when the state is the current state (initial false offcourse).  
- parent `StateFlow` | `undefined` - only set on subflows and regular states.  
- config <code>[stateDefinition](#stateDefinition)</code> - state defintion  

**Scope**: inner class of [stateflow](#module_stateflow)  
<a name="module_stateflow..State#get"></a>
### state.get(name)
Get an object value from the current state or it's parents.

**Params**

- name `string` - the object name  

<a name="module_stateflow..State#set"></a>
### state.set(name, obj)
Set a property

**Params**

- name `string`  
- obj `object` | `function` - object or getter function executed on `State#get`  

<a name="module_stateflow..State#onStateActive"></a>
### state.onStateActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the state is active, removed on exit.

**Params**

- objectOrName `object` | `string` - the service name (string) which was registered with set or event emitter instance (object),  
- event `string` - the event to listen on  
- listener `callback` | `string` - event listener function or state completion event  

<a name="module_stateflow..State#onFlowActive"></a>
### state.onFlowActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the flow is running, removed when the flow exits.

**Params**

- objectOrName `object` | `string` - object: the source object to listen on, string: the source name retrieved by state.get(name)  
- event `string` - the event to listen on  
- listener  - {string|function) string: send state completion event, function: event listener function.  

<a name="module_stateflow..State#cancelTimeout"></a>
### state.cancelTimeout()
Cancel the previous installed timeout, always executed when state exits.Can be used within a state action.

<a name="module_stateflow..State#installTimeout"></a>
### state.installTimeout(timeout, handler)
Install a state timeout handler fired when the state is active, cancelled on state exit.

**Params**

- timeout `number` | `undefined` - timeout in milliseconds, undefined: reuse the last timeout after the last cancelTimeout()  
- handler `callback` | `string` | `undefined` - callback: timeout function, string: emit state event on timeout, undefined: reuse the last handler after cancelTimeout()  

<a name="module_stateflow..StateFlow"></a>
## class: stateflow~StateFlow
**Extends**: `State`  
**Members**

* [class: stateflow~StateFlow](#module_stateflow..StateFlow)
  * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
  * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
  * [stateFlow.getStateObject(state)](#module_stateflow..StateFlow#getStateObject)

<a name="new_module_stateflow..StateFlow"></a>
### new stateflow~StateFlow(config)
StateFlow is an async event state machine, using js object notation.<br/>Every property is a state, the key is state name and the value is the state config:<br/> action: function, register action, or subflow definition.<br/> on: on key source event (or sourceObjectName.event) goto value: the next state<br/> type: 'begin': the initial state of the flow, 'end': the state that terminates the flow after executing action.<pre>Usage:var flow = new StateFlow({     beginState: {         type: 'begin',         action: function (complete) {             complete('anEvent');         },         on: {             anEvent:'nextState'         }     },     nextState: {         type: 'end',         action: function (complete) {             complete('done');          }      }});flow.start(function (event) {    if(event !== 'done') throw new Error('event must be done, as in nextState');});</pre>

**Params**

- config <code>[flowDefinition](#flowDefinition)</code> - flow definition  

**Properties**

- currentState `string`  
- parent `StateFlow`  

**Extends**: `State`  
**Scope**: inner class of [stateflow](#module_stateflow)  
<a name="module_stateflow..StateFlow#start"></a>
### stateFlow.start(complete)
Start the flow with the state of type 'begin'

**Params**

- complete `completion` - callback to be called when the end state has been reached.  

<a name="module_stateflow..StateFlow#getStateObject"></a>
### stateFlow.getStateObject(state)
Get the state instance object also associated with the state action this.Used to provide functionality and data to a state see {State}.For every state there is state instance.

**Params**

- state `string` - state name to get an state object for  

**Returns**: `State` - state instance object  
<a name="parse"></a>
# parse()
Creates a flow definition object from a simple flow language which can be passed to the StateFlow constructor

<a name="stateDefinition"></a>
# type: stateDefinition
**Properties**

- type `string` - 'begin': initial state on flow start, 'state': normal state (default), 'end': flow terminates when this state  
- action `action` - executed when the state becomes active, defined a function, action name to use a registered action or subflow object flow defintion.  
- initialize `function` - is called when the flow starts.  
- destroy `function` - is called when the flow exits.  
- on `object` - key is state completion event value is the next state to goto. 'objectName.eventName' is also supported, aka if this.get('objectName') emits eventName then goto the next state .  

<a name="flowDefinition"></a>
# type: flowDefinition
**Properties**

- *stateName* <code>[stateDefinition](#stateDefinition)</code> - every state has a state name and a state definition.  

**Type**: `object`  
