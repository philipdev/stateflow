## Classes
<dl>
<dt><a href="#State">State</a></dt>
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
<dt><a href="#load">load(resource, loader, cb)</a></dt>
<dd><p>Load a flow and it&#39;s subflows</p>
</dd>
</dl>
## Events
<dl>
<dt><a href="#state_stateName">"state:stateName"</a></dt>
<dd><p>Event fired when a specific stateName state has been reached, if new listener is added with an state:stateName which is already
current then the event will also be fired (stateName must must be replaced with an actual state).</p>
</dd>
<dt><a href="#event_stateChanged">"stateChanged" (state, oldState)</a></dt>
<dd><p>Emitted for every state change,</p>
</dd>
<dt><a href="#exit State exit event with the completed state name,event_ at this point the state is no longer active.">" at this point the state is no longer active."</a></dt>
<dd></dd>
</dl>
## Typedefs
<dl>
<dt><a href="#stateDefinition">stateDefinition</a></dt>
<dd></dd>
<dt><a href="#flowDefinition">flowDefinition</a> : <code>object</code></dt>
<dd></dd>
<dt><a href="#flowDefinition">flowDefinition</a> : <code>object</code></dt>
<dd><p>where the key is the state and the value a <a href="#stateDefinition">stateDefinition</a></p>
</dd>
<dt><a href="#action">action</a> : <code>function</code></dt>
<dd><p>State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>
If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>
If defined by flow definition then start and end of the flow will be mapped to the state.</p>
</dd>
<dt><a href="#completion">completion</a> : <code>function</code></dt>
<dd><p>State completion callback  available as first argument of <a href="#action">action</a> or as stateComplete property of <a href="#State">State</a>.</p>
</dd>
</dl>
<a name="State"></a>
## State
**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| active | <code>boolean</code> | is true when the state is the current state (initial false offcourse). |
| parent | <code>StateFlow</code> &#124; <code>undefined</code> | only set on subflows and regular states. |
| config | <code>[stateDefinition](#stateDefinition)</code> | state defintion |


* [State](#State)
  * [new State(config, name, parent)](#new_State_new)
  * [.set(name, obj)](#State+set)
  * [.onStateActive(objectOrName, event, listener)](#State+onStateActive)
  * [.onFlowActive(objectOrName, event, listener)](#State+onFlowActive)
  * [.cancelTimeout()](#State+cancelTimeout)
  * [.installTimeout(timeout, handler)](#State+installTimeout)

<a name="new_State_new"></a>
### new State(config, name, parent)
Instance assigned to each state in a flow and bound to the action's this variable.


| Param | Type | Description |
| --- | --- | --- |
| config | <code>[stateDefinition](#stateDefinition)</code> | subflow definition which might contain additional properties. |
| name | <code>string</code> | state name. |
| parent | <code>StateFlow</code> | flow. |

<a name="State+set"></a>
### state.set(name, obj)
Set a property

**Kind**: instance method of <code>[State](#State)</code>  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> |  |
| obj | <code>object</code> &#124; <code>function</code> | object or getter function executed on [State#get](State#get) |

<a name="State+onStateActive"></a>
### state.onStateActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the state is active, removed on exit.

**Kind**: instance method of <code>[State](#State)</code>  

| Param | Type | Description |
| --- | --- | --- |
| objectOrName | <code>object</code> &#124; <code>string</code> | the service name (string) which was registered with set or event emitter instance (object), |
| event | <code>string</code> | the event to listen on |
| listener | <code>callback</code> &#124; <code>string</code> | event listener function or state completion event |

<a name="State+onFlowActive"></a>
### state.onFlowActive(objectOrName, event, listener)
Listen to an event on the source (name or object) while the flow is running, removed when the flow exits.

**Kind**: instance method of <code>[State](#State)</code>  

| Param | Type | Description |
| --- | --- | --- |
| objectOrName | <code>object</code> &#124; <code>string</code> | object: the source object to listen on, string: the source name retrieved by state.get(name) |
| event | <code>string</code> | the event to listen on |
| listener |  | {string|function) string: send state completion event, function: event listener function. |

<a name="State+cancelTimeout"></a>
### state.cancelTimeout()
Cancel the previous installed timeout, always executed when state exits.Can be used within a state action.

**Kind**: instance method of <code>[State](#State)</code>  
<a name="State+installTimeout"></a>
### state.installTimeout(timeout, handler)
Install a state timeout handler fired when the state is active, cancelled on state exit.

**Kind**: instance method of <code>[State](#State)</code>  

| Param | Type | Description |
| --- | --- | --- |
| timeout | <code>number</code> &#124; <code>undefined</code> | timeout in milliseconds, undefined: reuse the last timeout after the last cancelTimeout() |
| handler | <code>callback</code> &#124; <code>string</code> &#124; <code>undefined</code> | callback: timeout function, string: emit state event on timeout, undefined: reuse the last handler after cancelTimeout() |

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
| parent | <code>StateFlow</code> | parent flow if this is a subflow |
| loader | <code>function</code> | resource loader |

<a name="load"></a>
## load(resource, loader, cb)
Load a flow and it's subflows

**Kind**: global function  

| Param | Description |
| --- | --- |
| resource | the name of the flow to load |
| loader | the loader which actually loads the name as a string, has to paramers the resource to load and the callback, the first argument is error or undefined and the second is the source string |
| cb |  |

<a name="state_stateName"></a>
## "state:stateName"
Event fired when a specific stateName state has been reached, if new listener is added with an state:stateName which is alreadycurrent then the event will also be fired (stateName must must be replaced with an actual state).

**Kind**: event emitted  
<a name="event_stateChanged"></a>
## "stateChanged" (state, oldState)
Emitted for every state change,

**Kind**: event emitted  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>string</code> | new state |
| oldState | <code>string</code> | previous state |

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

<a name="flowDefinition"></a>
## flowDefinition : <code>object</code>
where the key is the state and the value a [stateDefinition](#stateDefinition)

**Kind**: global typedef  
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
State completion callback  available as first argument of [action](#action) or as stateComplete property of [State](#State).

**Kind**: global typedef  

| Param | Type | Description |
| --- | --- | --- |
| event | <code>string</code> | completion event |

