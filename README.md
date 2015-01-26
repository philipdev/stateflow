#Index

**Modules**

* [stateflow](#module_stateflow)
  * [callback: stateflow~action](#module_stateflow..action)
  * [callback: stateflow~completion](#module_stateflow..completion)
  * [class: stateflow~State](#module_stateflow..State)
    * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
    * [state.get(name)](#module_stateflow..State#get)
    * [state.set(name, obj)](#module_stateflow..State#set)
    * [state.listenTo(objectOrName, event, listener)](#module_stateflow..State#listenTo)
    * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
    * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)
  * [class: stateflow~StateFlow](#module_stateflow..StateFlow)
    * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
    * [stateFlow.getRegisteredAction()](#module_stateflow..StateFlow#getRegisteredAction)
    * [stateFlow.getSubFlowConfig(state)](#module_stateflow..StateFlow#getSubFlowConfig)
    * [stateFlow.isSubFlowState()](#module_stateflow..StateFlow#isSubFlowState)
    * [stateFlow.getAction(state)](#module_stateflow..StateFlow#getAction)
    * [stateFlow.createSubFlowAction()](#module_stateflow..StateFlow#createSubFlowAction)
    * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
    * [stateFlow.go(state, complete)](#module_stateflow..StateFlow#go)
    * [stateFlow.createStateHandler(state, stateObj, flowCompleted)](#module_stateflow..StateFlow#createStateHandler)
    * [stateFlow.getStateObject(the)](#module_stateflow..StateFlow#getStateObject)

**Typedefs**

* [type: stateDefinition](#stateDefinition)
* [type: flowDefinition](#flowDefinition)
 
<a name="module_stateflow"></a>
#stateflow
**Members**

* [stateflow](#module_stateflow)
  * [callback: stateflow~action](#module_stateflow..action)
  * [callback: stateflow~completion](#module_stateflow..completion)
  * [class: stateflow~State](#module_stateflow..State)
    * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
    * [state.get(name)](#module_stateflow..State#get)
    * [state.set(name, obj)](#module_stateflow..State#set)
    * [state.listenTo(objectOrName, event, listener)](#module_stateflow..State#listenTo)
    * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
    * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)
  * [class: stateflow~StateFlow](#module_stateflow..StateFlow)
    * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
    * [stateFlow.getRegisteredAction()](#module_stateflow..StateFlow#getRegisteredAction)
    * [stateFlow.getSubFlowConfig(state)](#module_stateflow..StateFlow#getSubFlowConfig)
    * [stateFlow.isSubFlowState()](#module_stateflow..StateFlow#isSubFlowState)
    * [stateFlow.getAction(state)](#module_stateflow..StateFlow#getAction)
    * [stateFlow.createSubFlowAction()](#module_stateflow..StateFlow#createSubFlowAction)
    * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
    * [stateFlow.go(state, complete)](#module_stateflow..StateFlow#go)
    * [stateFlow.createStateHandler(state, stateObj, flowCompleted)](#module_stateflow..StateFlow#createStateHandler)
    * [stateFlow.getStateObject(the)](#module_stateflow..StateFlow#getStateObject)

<a name="module_stateflow..action"></a>
##callback: stateflow~action
State activation action, can be defined as function, by name (string) or by sub flow definition (object).<br/>If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>If defined by flow definition then start and end of the flow will be mapped to the state.

**Params**

- completion `completion` - state completion callback  

**Scope**: inner typedef of [stateflow](#module_stateflow)  
**Type**: `function`  
<a name="module_stateflow..completion"></a>
##callback: stateflow~completion
State completion callback  available as first argument of `action` or as stateComplete property of `State`.

**Params**

- event `string` - completion event  

**Scope**: inner typedef of [stateflow](#module_stateflow)  
**Type**: `function`  
<a name="module_stateflow..State"></a>
##class: stateflow~State
**Members**

* [class: stateflow~State](#module_stateflow..State)
  * [new stateflow~State(config, name, parent)](#new_module_stateflow..State)
  * [state.get(name)](#module_stateflow..State#get)
  * [state.set(name, obj)](#module_stateflow..State#set)
  * [state.listenTo(objectOrName, event, listener)](#module_stateflow..State#listenTo)
  * [state.cancelTimeout()](#module_stateflow..State#cancelTimeout)
  * [state.installTimeout(timeout, handler)](#module_stateflow..State#installTimeout)

<a name="new_module_stateflow..State"></a>
###new stateflow~State(config, name, parent)
Instance assigned to each state in a flow and bound to the action's this variable.

**Params**

- config `object` - subflow definition which might contain additional properties.  
- name `string` - state name.  
- parent `StateFlow` - flow.  

**Properties**

- active `boolean` - is true when the state is the current state (initial false offcourse).  
- parent `StateFlow` | `undefined` - only set on subflows and regular states.  
- config <code>[stateDefinition](#stateDefinition)</code> - state defintion  

**Scope**: inner class of [stateflow](#module_stateflow)  
<a name="module_stateflow..State#get"></a>
###state.get(name)
Get an object value from the current state or it's parents.

**Params**

- name `string` - the object name  

<a name="module_stateflow..State#set"></a>
###state.set(name, obj)
Set a property

**Params**

- name `string`  
- obj `object` | `function` - object or getter function which will be executed on `State#get`  

<a name="module_stateflow..State#listenTo"></a>
###state.listenTo(objectOrName, event, listener)
Listen to a service event while the state is active.All events registered with 'listenTo' while be automatically removed when the state exits. if the listener is a string then it's considered a state completion event.

**Params**

- objectOrName `object` | `string` - the service name (string) which was registered with set or event emitter instance (object),  
- event `string` - the event to listen on  
- listener `callback` | `string` - event listener or state completion event  

<a name="module_stateflow..State#cancelTimeout"></a>
###state.cancelTimeout()
Cancel the previous installed timeout, note this function is impliciltly called when the state exists, but might be necessary whensub sequenctial async calls must be called after operation was complete which should not be influenced by a timeout.

<a name="module_stateflow..State#installTimeout"></a>
###state.installTimeout(timeout, handler)
Install a state timeout handler.

**Params**

- timeout `integer` - the timeout in ms  
- handler `callback` | `string` - the function or completion event (string) to be called when the timeout expires or the completion event to be fired when timeout expires.  

<a name="module_stateflow..StateFlow"></a>
##class: stateflow~StateFlow
**Extends**: `State`  
**Members**

* [class: stateflow~StateFlow](#module_stateflow..StateFlow)
  * [new stateflow~StateFlow(config)](#new_module_stateflow..StateFlow)
  * [stateFlow.getRegisteredAction()](#module_stateflow..StateFlow#getRegisteredAction)
  * [stateFlow.getSubFlowConfig(state)](#module_stateflow..StateFlow#getSubFlowConfig)
  * [stateFlow.isSubFlowState()](#module_stateflow..StateFlow#isSubFlowState)
  * [stateFlow.getAction(state)](#module_stateflow..StateFlow#getAction)
  * [stateFlow.createSubFlowAction()](#module_stateflow..StateFlow#createSubFlowAction)
  * [stateFlow.start(complete)](#module_stateflow..StateFlow#start)
  * [stateFlow.go(state, complete)](#module_stateflow..StateFlow#go)
  * [stateFlow.createStateHandler(state, stateObj, flowCompleted)](#module_stateflow..StateFlow#createStateHandler)
  * [stateFlow.getStateObject(the)](#module_stateflow..StateFlow#getStateObject)

<a name="new_module_stateflow..StateFlow"></a>
###new stateflow~StateFlow(config)
StateFlow is an async event state machine, defined with an js object where the property is the state and the value the state definition.<br/><pre>Usage:var flow = new StateFlow({     beginState: {         type: 'begin',         action: function (complete) {             complete('anEvent');         },         on: {             anEvent:'nextState'         }     },     nextState: {         type: 'end',         action: function (complete) {             complete('done');          }      }});flow.start(function (event) {    if(event !== 'done') throw new Error('event must be done, as in nextState');});</pre>

**Params**

- config <code>[flowDefinition](#flowDefinition)</code> - flow definition  

**Properties**

- currentState `string`  
- parent `StateFlow`  

**Extends**: `State`  
**Scope**: inner class of [stateflow](#module_stateflow)  
<a name="module_stateflow..StateFlow#getRegisteredAction"></a>
###stateFlow.getRegisteredAction()
Get registered action from the current flow, travel the parent chain until the named action is found (aka action's registered in the parent flow are also available in the subflow).

**Returns**: `string` | `object` | `function` - literal registered action  
<a name="module_stateflow..StateFlow#getSubFlowConfig"></a>
###stateFlow.getSubFlowConfig(state)
**Params**

- state `string` - the state to get the sub flow  

**Returns**: `object` - the flow definition of a sub flow.  
<a name="module_stateflow..StateFlow#isSubFlowState"></a>
###stateFlow.isSubFlowState()
Check state action is a subflow or references a subflow.

**Returns**: `Boolean`  
<a name="module_stateflow..StateFlow#getAction"></a>
###stateFlow.getAction(state)
Get state action function

**Params**

- state  - state name to get the action from.  

**Returns**: `action`  
<a name="module_stateflow..StateFlow#createSubFlowAction"></a>
###stateFlow.createSubFlowAction()
**Returns**: `action` - subflow state action  
<a name="module_stateflow..StateFlow#start"></a>
###stateFlow.start(complete)
Start the flow with the state of type 'begin'

**Params**

- complete `completion` - callback to be called when the end state has been reached.  

<a name="module_stateflow..StateFlow#go"></a>
###stateFlow.go(state, complete)
Set the flow in a specific state

**Params**

- state `string` - the state to set to  
- complete `completion` - the callback to be called when a state of type 'end' is reached, aka when the "flow-state" has been ended.  

**Properties**

- currentState `string` - is set to the given state.  

<a name="module_stateflow..StateFlow#createStateHandler"></a>
###stateFlow.createStateHandler(state, stateObj, flowCompleted)
Create a completion function which is used as the callback argument for the <tt>state</tt> action, this callback will move the flow to the next state when a matching event is found.

**Params**

- state `string` - the state where callback is created for  
- stateObj `object`  
- flowCompleted `completion` - callback to be called when the flow reaches the end state.  

**Returns**: `completion` - complete  callback to be use by a state action to continue the flow.  
<a name="module_stateflow..StateFlow#getStateObject"></a>
###stateFlow.getStateObject(the)
Get the instance object which will be associated with the state action this.Used to provide functionallity and data state see {State}.For every state there is state object.

**Params**

- the `string` - state name to get an state object for  

**Returns**: `State` - the state object  
<a name="stateDefinition"></a>
#type: stateDefinition
**Properties**

- type `string` - 'begin': initial state on flow start, 'state': normal state (default), 'end': flow terminates when this state  
- action `action` - executed when the state becomes active, when the action property is a string then it lookup the function the previously registerAction(), when action is an object the flow will create a sub flow which will be started when the state becomes active.  
- on `object` - key is state completion event value is the next state to goto.  

<a name="flowDefinition"></a>
#type: flowDefinition
**Properties**

- *stateName* <code>[stateDefinition](#stateDefinition)</code> - every state has a state name and a state definition.  

**Type**: `object`  
