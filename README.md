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

## Classes
<dl>
<dt><a href="#StateFlow">StateFlow</a> ⇐ <code>State</code></dt>
<dd></dd>
</dl>
## Functions
<dl>
<dt><a href="#parse">parse()</a></dt>
<dd><p>Creates a flow definition object from a simple flow language which can be passed to the StateFlow constructor</p>
</dd>
<dt><a href="#Get an object value from the current state or it's parents.">Get an object value from the current state or it's parents.(name)</a></dt>
<dd></dd>
<dt><a href="#create">create(flowSource, name, parent, loader)</a></dt>
<dd><p>Create a flow from a flow definition language
Syntax:
 state.action = myAction; // or any other property
 state.event -&gt; next-state;</p>
<p> Also:
 state.property = value
value can be either a boolean, number or string. 
Quoted strings accept all characters except the quote used. a literal string only allows alpha numeric and -
All actions must be registered with registerAction.</p>
</dd>
</dl>
## Events
<dl>
<dt><a href="#exit State exit event with the completed state name,event_ at this point the state is no longer active.">" at this point the state is no longer active." (config, name, parent)</a></dt>
<dd><p>Instance assigned to each state in a flow and bound to the action&#39;s this variable.</p>
</dd>
</dl>
## Typedefs
<dl>
<dt><a href="#stateDefinition">stateDefinition</a></dt>
<dd></dd>
<dt><a href="#flowDefinition">flowDefinition</a> : <code>object</code></dt>
<dd></dd>
<dt><a href="#action">action</a> : <code>function</code></dt>
<dd><p>State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>
If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>
If defined by flow definition then start and end of the flow will be mapped to the state.</p>
</dd>
<dt><a href="#completion">completion</a> : <code>function</code></dt>
<dd><p>State completion callback  available as first argument of <a href="#action">action</a> or as stateComplete property of <a href="State">State</a>.</p>
</dd>
</dl>
<a name="StateFlow"></a>
## StateFlow ⇐ <code>State</code>
**Kind**: global class  
**Extends:** <code>State</code>  
**Properties**

| Name | Type |
| --- | --- |
| currentState | <code>string</code> | 
| parent | <code>[StateFlow](#StateFlow)</code> | 


* [StateFlow](#StateFlow) ⇐ <code>State</code>
  * [new StateFlow(config)](#new_StateFlow_new)
  * _instance_
    * [.start(complete)](#StateFlow+start)
    * [.getStateObject(state)](#StateFlow+getStateObject) ⇒ <code>State</code>
    * [.set(name, obj)](#State+set)
    * [.onStateActive(objectOrName, event, listener)](#State+onStateActive)
    * [.onFlowActive(objectOrName, event, listener)](#State+onFlowActive)
    * [.cancelTimeout()](#State+cancelTimeout)
    * [.installTimeout(timeout, handler)](#State+installTimeout)
  * _inner_
    * ["state:stateName"](#StateFlow..state_stateName)
    * ["stateChanged" (state, oldState)](#StateFlow..event_stateChanged)
    * [~stateDefinition](#StateFlow..stateDefinition) : <code>object</code>
    * [~flowDefinition](#StateFlow..flowDefinition) : <code>object</code>

<a name="new_StateFlow_new"></a>
### new StateFlow(config)
StateFlow is an async event state machine, using js object notation.<br/>Every property is a state, the key is state name and the value is the state config:<br/> action: function, register action, or subflow definition.<br/> on: on key source event (or sourceObjectName.event) goto value: the next state<br/> type: 'begin': the initial state of the flow, 'end': the state that terminates the flow after executing action.<pre>Usage:var flow = new StateFlow({     beginState: {         type: 'begin',         action: function (complete) {             complete('anEvent');         },         on: {             anEvent:'nextState'         }     },     nextState: {         type: 'end',         action: function (complete) {             complete('done');          }      }});flow.start(function (event) {    if(event !== 'done') throw new Error('event must be done, as in nextState');});</pre>


| Param | Type | Description |
| --- | --- | --- |
| config | <code>[flowDefinition](#flowDefinition)</code> | flow definition |

<a name="StateFlow+start"></a>
### stateFlow.start(complete)
Start the flow with the state of type 'begin'

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| complete | <code>[completion](#completion)</code> | callback to be called when the end state has been reached. |

<a name="StateFlow+getStateObject"></a>
### stateFlow.getStateObject(state) ⇒ <code>State</code>
Get the state instance object also associated with the state action this.Used to provide functionality and data to a state see {State}.For every state there is state instance.

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  
**Returns**: <code>State</code> - state instance object  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>string</code> | state name to get an state object for |

<a name="State+set"></a>
### stateFlow.set(name, obj)
Set a property

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> |  |
| obj | <code>object</code> &#124; <code>function</code> | object or getter function executed on [State#get](State#get) |

<a name="State+onStateActive"></a>
### stateFlow.onStateActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the state is active, removed on exit.

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| objectOrName | <code>object</code> &#124; <code>string</code> | the service name (string) which was registered with set or event emitter instance (object), |
| event | <code>string</code> | the event to listen on |
| listener | <code>callback</code> &#124; <code>string</code> | event listener function or state completion event |

<a name="State+onFlowActive"></a>
### stateFlow.onFlowActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the flow is running, removed when the flow exits.

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| objectOrName | <code>object</code> &#124; <code>string</code> | object: the source object to listen on, string: the source name retrieved by state.get(name) |
| event | <code>string</code> | the event to listen on |
| listener |  | {string|function) string: send state completion event, function: event listener function. |

<a name="State+cancelTimeout"></a>
### stateFlow.cancelTimeout()
Cancel the previous installed timeout, always executed when state exits.Can be used within a state action.

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  
<a name="State+installTimeout"></a>
### stateFlow.installTimeout(timeout, handler)
Install a state timeout handler fired when the state is active, cancelled on state exit.

**Kind**: instance method of <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| timeout | <code>number</code> &#124; <code>undefined</code> | timeout in milliseconds, undefined: reuse the last timeout after the last cancelTimeout() |
| handler | <code>callback</code> &#124; <code>string</code> &#124; <code>undefined</code> | callback: timeout function, string: emit state event on timeout, undefined: reuse the last handler after cancelTimeout() |

<a name="StateFlow..state_stateName"></a>
### "state:stateName"
Event fired when a specific stateName state has been reached, if new listener is added with an state:stateName which is alreadycurrent then the event will also be fired (stateName must must be replaced with an actual state).

**Kind**: event emitted by <code>[StateFlow](#StateFlow)</code>  
<a name="StateFlow..event_stateChanged"></a>
### "stateChanged" (state, oldState)
Emitted for every state change,

**Kind**: event emitted by <code>[StateFlow](#StateFlow)</code>  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>string</code> | new state |
| oldState | <code>string</code> | previous state |

<a name="StateFlow..stateDefinition"></a>
### StateFlow~stateDefinition : <code>object</code>
**Kind**: inner typedef of <code>[StateFlow](#StateFlow)</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| action | <code>string</code> &#124; <code>[action](#action)</code> &#124; <code>[flowDefinition](#flowDefinition)</code> | this action is executed when the state becomes active |
|  | <code>object</code> | on event <key> goto state <value>, the event source is the instance state or an object (separated by a dot: "source.event" : "nextstate". |

<a name="StateFlow..flowDefinition"></a>
### StateFlow~flowDefinition : <code>object</code>
where the key is the state and the value a [stateDefinition](#stateDefinition)

**Kind**: inner typedef of <code>[StateFlow](#StateFlow)</code>  
<a name="parse"></a>
## parse()
Creates a flow definition object from a simple flow language which can be passed to the StateFlow constructor

**Kind**: global function  
<a name="Get an object value from the current state or it's parents."></a>
## Get an object value from the current state or it's parents.(name)
**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the object name |

<a name="create"></a>
## create(flowSource, name, parent, loader)
Create a flow from a flow definition languageSyntax: state.action = myAction; // or any other property state.event -> next-state;  Also: state.property = valuevalue can be either a boolean, number or string. Quoted strings accept all characters except the quote used. a literal string only allows alpha numeric and -All actions must be registered with registerAction.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| flowSource | <code>string</code> | source text of the simple flow language |
| name | <code>string</code> | flow name optional |
| parent | <code>[StateFlow](#StateFlow)</code> | parent flow if this is a subflow |
| loader | <code>function</code> | resource loader |

<a name="stateDefinition"></a>
## stateDefinition
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| type | <code>string</code> | 'begin': initial state on flow start, 'state': normal state (default), 'end': flow terminates when this state |
| action | <code>[action](#action)</code> | executed when the state becomes active, defined a function, action name to use a registered action or subflow object flow defintion. |
| initialize | <code>function</code> | is called when the flow starts. |
| destroy | <code>function</code> | is called when the flow exits. |
| on | <code>object</code> | key is state completion event value is the next state to goto. 'objectName.eventName' is also supported, aka if this.get('objectName') emits eventName then goto the next state . |

<a name="flowDefinition"></a>
## flowDefinition : <code>object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| *stateName* | <code>[stateDefinition](#stateDefinition)</code> | every state has a state name and a state definition. |

<a name="action"></a>
## action : <code>function</code>
State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>If defined by flow definition then start and end of the flow will be mapped to the state.

**Kind**: global typedef  
**this**: <code>{State}</code>  

| Param | Type | Description |
| --- | --- | --- |
| completion | <code>[completion](#completion)</code> | state completion callback |

<a name="completion"></a>
## completion : <code>function</code>
State completion callback  available as first argument of [action](#action) or as stateComplete property of [State](State).

**Kind**: global typedef  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>string</code> | completion event |

