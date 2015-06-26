(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.stateflow = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (__dirname){
/*jslint node: true */
'use strict';
var peg = require('pegjs');
var fs = require('fs');


var parser = peg.buildParser(fs.readFileSync(__dirname +"/parser.txt", "utf8"));

function getState(flow, name) {
    if(!flow[name]) {
        flow[name] = {
            on : {}
        };
    }
    
    return flow[name];
}

/**
 * Creates a flow definition object from a simple flow language which can be passed to the StateFlow constructor
 */
var parse = function(src, loader) { // we might need caching
    var obj = {}, parserResult = parser.parse(src);
    // Figure out if i can move this to the parser, because i want to reuse this logic
    // Can also register this as a util function to the parser
    parserResult.forEach(function(row) {
        if(row[0] === 'event') {
            getState(obj, row[1]).on[row[2]] = row[3];
        } else  if(row[0] === 'property'){
            if(row[2] === 'action' && row[3].indexOf('@') === 0 && typeof loader === 'function' ) {
                // action starts with @, then we load the subflow
                getState(obj, row[1])[row[2]] = parse(loader(row[3].substring(1)));
            } else {
                getState(obj, row[1])[row[2]] = row[3];
            }
            
        } else if(row[0] === 'function') {
            // this is really cool!, only real downside is the parser might throw unclear errors when the blocks are not balanced!
            /*jslint evil: true */
            getState(obj, row[1])[row[2]] = new Function(['complete'], row[3]);
        }
    });
    
    return obj;
};
module.exports = parse;
}).call(this,"/lib")
},{"fs":3,"pegjs":18}],2:[function(require,module,exports){
/*jslint node: true */
'use strict';
/**
 * @module stateflow
 */
var util = require('util');
var parser = require('./parser');
var EventEmitter = require('events').EventEmitter;

/**
 * @typedef stateDefinition
 * @property type {string} 'begin': initial state on flow start, 'state': normal state (default), 'end': flow terminates when this state 
 * @property action {action} executed when the state becomes active, defined a function, action name to use a registered action or subflow object flow defintion.
 * @property initialize {function} is called when the flow starts.
 * @property destroy  {function} is called when the flow exits.
 * @property on {object} key is state completion event value is the next state to goto. 'objectName.eventName' is also supported, aka if this.get('objectName') emits eventName then goto the next state .
 */

 /**
 * @typedef flowDefinition {object}
 * @property *stateName* {stateDefinition} every state has a state name and a state definition.
 */

/**
 * Instance assigned to each state in a flow and bound to the action's this variable.
 * @constructor
 * @param {stateDefinition} config subflow definition which might contain additional properties.
 * @param {string} name state name.
 * @param {StateFlow} parent flow.
 * @property {boolean} active is true when the state is the current state (initial false offcourse).
 * @property {StateFlow|undefined} parent only set on subflows and regular states.
 * @property {stateDefinition} config state defintion
 */
function State(config, name, parent) {
    var self = this;
    this.data = {};

    /**
     * @typedef {object} StateFlow~stateDefinition
     * @property {string|action|flowDefinition} action - this action is executed when the state becomes active
     * @property {object} - on event <key> goto state <value>, the event source is the instance state or an object (separated by a dot: "source.event" : "nextstate". 
     */
    this.config = config;
    this.name = name;
    this.parent = parent;

    // an array of objects with follwing properties: target, event, listener
    this.listeners = [];

    this.flowActiveListeners = [];

    this.on('exit', function () {
        this.listeners.forEach(function (config) {
            config.source.removeListener(config.event, config.listener);
        });
        this.listeners = [];
        this.cancelTimeout();
    });

    if(parent) {
        parent.once('flow:exit', function() {
            self.flowActiveListeners.forEach( function(config) {
                config.source.removeListener(config.event, config.listener);
            });
            self.flowActiveListeners = [];
        });
    }

    this.timeout = 0;


    this.listeners = [];
}

util.inherits(State, EventEmitter);
/**
 * Get an object value from the current state or it's parents.
 * @param name {string} the object name
 */
State.prototype.get = function (name) {
    var value;
    if (this.data[name]) {
        value = this.data[name];
    } else if (this.parent) {
        value = this.parent.get(name);
    }
    if (typeof value === 'function') {
        return value();
    }
    return value;
};

/**
 * Set a property
 * @param name {string} 
 * @param obj {object|function} object or getter function executed on {@link State#get}
 */
State.prototype.set = function (name, obj) {
    this.data[name] = obj;
};

State.prototype.createListenerConfig = function(objectOrName, event, listener) {

    var self = this, listenerConfig = {
        source: typeof objectOrName === 'object' ? objectOrName : this.get(objectOrName),
        event: event,
        listener: listener
    };

    if(listener === undefined) { // listener is undefined so orignal event is complete event
        listenerConfig.listener = function () {
            self.stateComplete(event);
        };
    } else if (typeof listener === 'string') { // listener is a string complete event
        listenerConfig.listener = function () {
            self.stateComplete(listener);
        };
    } else {
        listenerConfig.listener = function () {
            listener.apply(self, arguments); // call the listener with stateobject as "this"
        };
    }
    return listenerConfig;
};
 /**
  * Listen to an event on the source (name or object) while the state is active, removed on exit.
  *
  * @param objectOrName {object|string} the service name (string) which was registered with set or event emitter instance (object), 
  * @param event {string} the event to listen on
  * @param listener {callback|string} event listener function or state completion event 
  */
State.prototype.onStateActive = function (objectOrName, event, listener) {
    var listenerConfig = this.createListenerConfig(objectOrName,event, listener);

    if(typeof listenerConfig.source === 'object' && typeof listenerConfig.source.on === 'function') {
        listenerConfig.source.on(listenerConfig.event, listenerConfig.listener);
        this.listeners.push(listenerConfig); // listeners must be renamed too stateActiveListeners.
    }

};

State.prototype.listenTo = function(objectOrName, event, listener) {
    console.error("listenTo is deprecated please use 'onStateActive'");
    this.onStateActive(objectOrName, event, listener);
};

/**
 * Listen to an event on the source (name or object) while the flow is running, removed when the flow exits.
 * @param objectOrName {object|string} object: the source object to listen on, string: the source name retrieved by state.get(name)
 * @param event {string} the event to listen on
 * @param listener {string|function) string: send state completion event, function: event listener function.
 */
State.prototype.onFlowActive = function(objectOrName, event, listener) {
    var list, listenerConfig, key = {source: objectOrName, event:event, listener: listener};

    list = this.flowActiveListeners.filter(function (config) {
        return config.key.source === key.source && config.key.event === key.event && config.key.listener === key.listener;
    });

    if(list.length === 0) {
        listenerConfig = this.createListenerConfig(objectOrName, event, listener);
        listenerConfig.key = key;
        if(typeof listenerConfig.source === 'object' && typeof listenerConfig.source.on === 'function') { // only register if we have a valid source object1
            listenerConfig.source.on(listenerConfig.event, listenerConfig.listener);
            this.flowActiveListeners.push(listenerConfig);
        }
    } else if(list.length > 1) {
        throw new Error('More than one of the same onFlowActive listener registered!');
    }

};

/**
 * Cancel the previous installed timeout, always executed when state exits.
 * Can be used within a state action.
 */
State.prototype.cancelTimeout = function () {
    if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
    }
    delete this.lastTimeoutAction;
    delete this.lastTimeoutTime;
};

/**
 * Install a state timeout handler fired when the state is active, cancelled on state exit.
 * @param timeout {number|undefined} timeout in milliseconds, undefined: reuse the last timeout after the last cancelTimeout()
 * @param handler {callback|string|undefined} callback: timeout function, string: emit state event on timeout, undefined: reuse the last handler after cancelTimeout()
 */
State.prototype.installTimeout = function (timeout, handler) {
    var cb, self = this, effectiveTimeout = timeout || this.lastTimeoutTime;
    if (typeof handler === 'function') {
        cb = function () {
            handler.call(self);
        };
    } else if (typeof handler === 'string') {
        cb = function () {
            self.stateComplete(handler);
        };
    } else if (this.lastTimeoutAction) { 
        // install timeout without handler will reinstall the last after cancelTimeout() if there was such one.
        cb = this.lastTimeoutAction;
    } else {
        cb = function () {
            self.stateComplete('timeout');
        };
    }
    if( effectiveTimeout === undefined ) {
        throw new Error('Could not determ timeout value!');
    }

    this.cancelTimeout();

    this.timeoutHandle = setTimeout(cb, effectiveTimeout );
    this.lastTimeoutAction = cb;
    this.lastTimeoutTime = effectiveTimeout;
};

/**
 * StateFlow is an async event state machine, using js object notation.<br/>
 * Every property is a state, the key is state name and the value is the state config:<br/>
 *  action: function, register action, or subflow definition.<br/>
 *  on: on key source event (or sourceObjectName.event) goto value: the next state<br/>
 *  type: 'begin': the initial state of the flow, 'end': the state that terminates the flow after executing action.
 *
 * <pre>
 * Usage:
 * var flow = new StateFlow({
 *      beginState: {
 *          type: 'begin',
 *          action: function (complete) {
 *              complete('anEvent');
 *          },
 *          on: {
 *              anEvent:'nextState'
 *          }
 *      },
 *      nextState: {
 *          type: 'end',
 *          action: function (complete) {
 *              complete('done'); 
 *          } 
 *      }
 * });
 * flow.start(function (event) {
 *     if(event !== 'done') throw new Error('event must be done, as in nextState');
 * });
 * </pre>
 * @extends State
 * @constructor
 * @param config {flowDefinition} flow definition
 * @property currentState {string}
 * @property parent {StateFlow}
 */
function StateFlow(config, name, parent) {
    /**
     * @typedef StateFlow~flowDefinition {object} where the key is the state and the value a {@link stateDefinition}
     */
    State.call(this, config, name, parent);
    this.actions = {};
    this.actionsInitializers = {};
    this.actionsDestructors = {};

    this.states = {};
    this.on('newListener', function (event, listener) {
        // call a state listener when the state is already active
        if (event === 'state:' + this.currentState) {
            listener.call(this, this.currentState);
        }
    });

    this.on('flow:entry', function() {
        Object.keys(config).forEach(function (state) {
            this.initializeState(state);
        }, this);
    });

    this.on('flow:exit', function() {
        Object.keys(config).forEach(function (state) {
            this.destroyState(state);
        }, this);
        this.states = {};
    });

    this.serviceFromEventSeparator = '.';
}
util.inherits(StateFlow, State);

/**
 * Register a named action function
 * @param name {string} action name
 * @param action {function|string|object} called when the state becomes active
 * @param initializer {function} flow start callback
 * @param destructor {function} flow exit callback
 * @memberof StateFlow {
 */
StateFlow.prototype.registerAction = function (name, action, initializer, destructor) {
    this.actions[name] = action;
    if(typeof initializer ==='function') {
        this.actionsInitializers[name] = initializer;
    }
    if(typeof destructor === 'function') {
        this.actionsDestructors[name] = destructor;
    }
};

/**
 * Get registered action from the current flow, travel the parent chain until the named action is found (action's registered in the parent flow are also available in the subflow).
 * @returns literal registered action {string|object|function}
 * @private
 */
StateFlow.prototype.getRegisteredAction = function (name) {
    if (this.actions[name]) {
        return this.actions[name];
    }
    if (this.parent) {
        return this.parent.getRegisteredAction(name);
    }
};

/**
 * @param state {string} state name of a subflow
 * @returns {flowDefinition} flow definition of a subflow.
 * @private
 */
StateFlow.prototype.getSubFlowConfig = function (state) {
    var def = this.config[state], action;
    if (typeof def.action === 'object') {
        action = def.action;
    } else if (typeof def.action === 'string') {
        action = this.getRegisteredAction(def.action);
        if (typeof action !== 'object') {
            throw new Error(def + ' is not a subflow!');
        }
    } else {
        throw new Error(def.action + ' is not a subflow!');
    }

    return action;
};

/**
 * Check state action is a subflow or references a subflow.
 * @returns {Boolean}
 * @private
 */
StateFlow.prototype.isSubFlowState = function (state) {
    var def = this.config[state];
    if (typeof def.action === 'object') {
        return true;
    }
    return (typeof def.action === 'string' && typeof this.getRegisteredAction(def.action) === 'object');
};

StateFlow.prototype.initializeState = function(state) {
    var stateObject = this.getStateObject(state);

    if(typeof this.config[state].initialize === 'function') {
        this.config[state].initialize.call(stateObject);
    } else if(typeof state.action ==='string') {
        if( this.actionsInitializers[state.action]) {
            this.actionsInitializers[state.action].call(stateObject);
        }
    }
};

StateFlow.prototype.destroyState = function(state) {
    var stateObject = this.getStateObject(state);

    if(typeof this.config[state].destroy === 'function') {
        this.config[state].destroy.call(stateObject);
    }  else if(typeof state.action ==='string') {
        if( this.actionsDestructors[state.action]) {
            this.actionsDestructors[state.action].call(stateObject);
        }
    }

    delete this.states[state];
};

/**
 * Get state action function
 * @param state state name to get the action from.
 * @returns {action}
 * @private
 */
StateFlow.prototype.getAction = function (state) {
    var def = this.config[state], action;

    if (typeof def.action === 'function') {
        return def.action;
    }
    if (typeof def.action === 'string') {
        action = this.getRegisteredAction(def.action);
        if (typeof action === 'object') {
            return this.createSubFlowAction();
        }
        return action;
    }
    if (typeof def.action === 'object') {
        return this.createSubFlowAction();
    }
    throw new Error("No action found for state '" + state + "'");
};



/**
 * @returns {action} subflow state action
 * @private
 */
StateFlow.prototype.createSubFlowAction = function () {
    return function (complete) {
        // action is executed State object assigned to this in this case StateFlow
        this.start(function (event) {
            complete(event);
        }, true);
    };
};


/**
 * Start the flow with the state of type 'begin' 
 * @param complete {completion} callback to be called when the end state has been reached.
 */
StateFlow.prototype.start = function (complete, subflow) {
    var self = this, states = this.findStatesByType('begin');

    if (states.length === 0) {
        throw new Error('No begin state found!');
    }
    if (states.length > 1) {
        throw new Error('Too many begin states found!');
    }
    this.emit('flow:entry'); // TODO: flow:

    this.stateComplete = function(event) {
        self.emit('flow:exit', event); // TODO: flow:
        if( typeof complete === 'function') {
            complete(event);
        }
    };

    this.go(states[0], this.stateComplete);
};

/**
 * Find state by type
 * @param type {string} type to look for
 * @private
 */
StateFlow.prototype.findStatesByType = function (type) {
    return Object.keys(this.config).filter(function (stateName) {
        if (this[stateName].type === type || (type === 'state' && this[stateName].type === undefined)) {
            return true;
        }
    }, this.config);
};

/**
 * Set the flow in a specific state, this function is still considered internal because abruptly goes to the target state.
 * @param state {string} target state
 * @param complete {completion} the callback to be called when a state of type 'end' is reached, aka when the "flow-state" has been ended.
 * @property {string} currentState is set to the given state.
 * @private
 */
StateFlow.prototype.go = function (state, complete) {
    var stateDefinition = this.config[state], stateObj, action;

    if (stateDefinition === undefined) {
        throw new Error("No state defination found for state '" + state + "'");
    }

    stateObj = this.getStateObject(state);
     /**
      * State activation action, can be defined as function, by name (string) or by subflow definition (object).<br/>
      * If it was defined by name in the state definition then the must be been registered previously with registerAction().<br/>
      * If defined by flow definition then start and end of the flow will be mapped to the state.
      *
      * @callback action
      * @param completion {completion} state completion callback
      * @this {State}
      */
    action = this.getAction(state);
    if (action === undefined) {
        throw new Error(state + '.action' + ' is undefined');
    }
    stateObj.active = true;
    this.currentState = state;
    stateObj.stateComplete = this.createStateHandler(state, stateObj, complete);
    this.forwardEvents(stateObj, stateDefinition.on);
    /** 
     * State entry event fired just before a state action is called
     * @event State~entry 
     */
    stateObj.emit('entry', state);
     /** 
      * Event fired when a specific stateName state has been reached, if new listener is added with an state:stateName which is already
      * current then the event will also be fired (stateName must must be replaced with an actual state).
      * @event StateFlow~state:stateName 
      */
    this.emit('state:' + state);
    action.call(stateObj, stateObj.stateComplete);
};

StateFlow.prototype.forwardEvents = function (stateObject, on, complete) {
    var forwardEvents = [];
    if (typeof on === 'object') {
        forwardEvents = Object.keys(on);
    }

    forwardEvents.forEach(function (key) {
        var serviceAndEvent;

        if( key.indexOf(this.serviceFromEventSeparator) !== -1) {
            serviceAndEvent = key.split(this.serviceFromEventSeparator);
        } else {
            serviceAndEvent = [stateObject, key];
        }

        stateObject.onStateActive(serviceAndEvent[0], serviceAndEvent[1], function (event) {
            //noinspection JSPotentiallyInvalidUsageOfThis
            this.stateComplete(key); // when the service.event appears, emit it agian as service.event event!
        });
    }, this);
};

/**
 * Create a completion function action parameter callback, the callback moves the flow to the next state when a on event matches.
 * @param state {string} the state where callback is created for
 * @param stateObj {object} 
 * @param flowCompleted {completion} end of flow callback.
 * @return complete {completion}
 * @private
 */
StateFlow.prototype.createStateHandler = function (state, stateObj, flowCompleted) {
    var stateDefinition = this.config[state], self = this, completed = false, stateCompletion;

    if (stateDefinition === undefined) {
        throw new Error("No state definition found for state '" + state + "'");
    }

    /**
     * State completion callback  available as first argument of {@link action} or as stateComplete property of {@link State}.
     * @name completion
     * @callback completion
     * @param event {string} completion event
     */
    stateCompletion = function (event) {
        var targetState, exitFunction;
        exitFunction = function () {
            completed = true;
            /** 
             * State exit event with the completed state name, at this point the state is no longer active.
             * @event State~exit 
             */
            stateObj.emit('exit', targetState);
            stateObj.active = false;
        };
        if (!completed) {
            if (stateDefinition.type === 'end') {
                exitFunction();
                flowCompleted(event);
            } else if (typeof stateDefinition.on === 'object' && stateDefinition.on[event]) {
                targetState = stateDefinition.on[event];
            } else if (typeof stateDefinition.on === 'object' && stateDefinition.on['*']) {
                targetState = stateDefinition.on['*'];
            }
            if (targetState) {
                exitFunction();
                self.go(targetState, flowCompleted);
            }
        } else {
            console.error("State '" + state + "' already completed!");
        }
    };

    return stateCompletion;
};

/**
 * Get the state instance object also associated with the state action this.
 * Used to provide functionality and data to a state see {State}.
 *
 * For every state there is state instance.
 * @param state {string} state name to get an state object for
 * @return {State} state instance object
 */
StateFlow.prototype.getStateObject = function (state) {
    if (!this.states[state]) {
        if (this.isSubFlowState(state)) {
            this.states[state] = new StateFlow(this.getSubFlowConfig(state), state, this );
        } else {
            this.states[state] = new State(this.config[state], state, this);
        }
    }
    return this.states[state];
};

module.exports.StateFlow = StateFlow;
/**
 * Create a flow from a flow definition language
 * Syntax:
 *  state.action = myAction; // or any other property
 *  state.event -> next-state;
 *  
 *  Also:
 *  state.property = value
 * value can be either a boolean, number or string. 
 * Quoted strings accept all characters except the quote used. a literal string only allows alpha numeric and -
 * All actions must be registered with registerAction.
 * @param flowSource {string} source text of the simple flow language
 * @param name {string} flow name optional
 * @param parent {StateFlow} parent flow if this is a subflow
 * @param loader {function} resource loader
 */
module.exports.create = function(flowSource, name, parent, loader) {
    var def = parser(flowSource);
    return new StateFlow(def, name, parent);
};
},{"./parser":1,"events":4,"util":8}],3:[function(require,module,exports){

},{}],4:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],5:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],6:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            currentQueue[queueIndex].run();
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],7:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],8:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":7,"_process":6,"inherits":5}],9:[function(require,module,exports){
var utils = require("./utils");

module.exports = {
  /*
   * Compiler passes.
   *
   * Each pass is a function that is passed the AST. It can perform checks on it
   * or modify it as needed. If the pass encounters a semantic error, it throws
   * |PEG.GrammarError|.
   */
  passes: {
    check: {
      reportMissingRules:  require("./compiler/passes/report-missing-rules"),
      reportLeftRecursion: require("./compiler/passes/report-left-recursion")
    },
    transform: {
      removeProxyRules:    require("./compiler/passes/remove-proxy-rules")
    },
    generate: {
      generateBytecode:    require("./compiler/passes/generate-bytecode"),
      generateJavascript:  require("./compiler/passes/generate-javascript")
    }
  },

  /*
   * Generates a parser from a specified grammar AST. Throws |PEG.GrammarError|
   * if the AST contains a semantic error. Note that not all errors are detected
   * during the generation and some may protrude to the generated parser and
   * cause its malfunction.
   */
  compile: function(ast, passes) {
    var options = arguments.length > 2 ? utils.clone(arguments[2]) : {},
        stage;

    /*
     * Extracted into a function just to silence JSHint complaining about
     * creating functions in a loop.
     */
    function runPass(pass) {
      pass(ast, options);
    }

    utils.defaults(options, {
      allowedStartRules:  [ast.rules[0].name],
      cache:              false,
      optimize:           "speed",
      output:             "parser"
    });

    for (stage in passes) {
      if (passes.hasOwnProperty(stage)) {
        utils.each(passes[stage], runPass);
      }
    }

    switch (options.output) {
      case "parser": return eval(ast.code);
      case "source": return ast.code;
    }
  }
};

},{"./compiler/passes/generate-bytecode":11,"./compiler/passes/generate-javascript":12,"./compiler/passes/remove-proxy-rules":13,"./compiler/passes/report-left-recursion":14,"./compiler/passes/report-missing-rules":15,"./utils":19}],10:[function(require,module,exports){
/* Bytecode instruction opcodes. */
module.exports = {
  /* Stack Manipulation */

  PUSH:             0,    // PUSH c
  PUSH_CURR_POS:    1,    // PUSH_CURR_POS
  POP:              2,    // POP
  POP_CURR_POS:     3,    // POP_CURR_POS
  POP_N:            4,    // POP_N n
  NIP:              5,    // NIP
  APPEND:           6,    // APPEND
  WRAP:             7,    // WRAP n
  TEXT:             8,    // TEXT

  /* Conditions and Loops */

  IF:               9,    // IF t, f
  IF_ERROR:         10,   // IF_ERROR t, f
  IF_NOT_ERROR:     11,   // IF_NOT_ERROR t, f
  WHILE_NOT_ERROR:  12,   // WHILE_NOT_ERROR b

  /* Matching */

  MATCH_ANY:        13,   // MATCH_ANY a, f, ...
  MATCH_STRING:     14,   // MATCH_STRING s, a, f, ...
  MATCH_STRING_IC:  15,   // MATCH_STRING_IC s, a, f, ...
  MATCH_REGEXP:     16,   // MATCH_REGEXP r, a, f, ...
  ACCEPT_N:         17,   // ACCEPT_N n
  ACCEPT_STRING:    18,   // ACCEPT_STRING s
  FAIL:             19,   // FAIL e

  /* Calls */

  REPORT_SAVED_POS: 20,   // REPORT_SAVED_POS p
  REPORT_CURR_POS:  21,   // REPORT_CURR_POS
  CALL:             22,   // CALL f, n, pc, p1, p2, ..., pN

  /* Rules */

  RULE:             23,   // RULE r

  /* Failure Reporting */

  SILENT_FAILS_ON:  24,   // SILENT_FAILS_ON
  SILENT_FAILS_OFF: 25    // SILENT_FAILS_FF
};

},{}],11:[function(require,module,exports){
var utils = require("../../utils"),
    op    = require("../opcodes");

/* Generates bytecode.
 *
 * Instructions
 * ============
 *
 * Stack Manipulation
 * ------------------
 *
 *  [0] PUSH c
 *
 *        stack.push(consts[c]);
 *
 *  [1] PUSH_CURR_POS
 *
 *        stack.push(currPos);
 *
 *  [2] POP
 *
 *        stack.pop();
 *
 *  [3] POP_CURR_POS
 *
 *        currPos = stack.pop();
 *
 *  [4] POP_N n
 *
 *        stack.pop(n);
 *
 *  [5] NIP
 *
 *        value = stack.pop();
 *        stack.pop();
 *        stack.push(value);
 *
 *  [6] APPEND
 *
 *        value = stack.pop();
 *        array = stack.pop();
 *        array.push(value);
 *        stack.push(array);
 *
 *  [7] WRAP n
 *
 *        stack.push(stack.pop(n));
 *
 *  [8] TEXT
 *
 *        stack.pop();
 *        stack.push(input.substring(stack.top(), currPos));
 *
 * Conditions and Loops
 * --------------------
 *
 *  [9] IF t, f
 *
 *        if (stack.top()) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [10] IF_ERROR t, f
 *
 *        if (stack.top() === FAILED) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [11] IF_NOT_ERROR t, f
 *
 *        if (stack.top() !== FAILED) {
 *          interpret(ip + 3, ip + 3 + t);
 *        } else {
 *          interpret(ip + 3 + t, ip + 3 + t + f);
 *        }
 *
 * [12] WHILE_NOT_ERROR b
 *
 *        while(stack.top() !== FAILED) {
 *          interpret(ip + 2, ip + 2 + b);
 *        }
 *
 * Matching
 * --------
 *
 * [13] MATCH_ANY a, f, ...
 *
 *        if (input.length > currPos) {
 *          interpret(ip + 3, ip + 3 + a);
 *        } else {
 *          interpret(ip + 3 + a, ip + 3 + a + f);
 *        }
 *
 * [14] MATCH_STRING s, a, f, ...
 *
 *        if (input.substr(currPos, consts[s].length) === consts[s]) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [15] MATCH_STRING_IC s, a, f, ...
 *
 *        if (input.substr(currPos, consts[s].length).toLowerCase() === consts[s]) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [16] MATCH_REGEXP r, a, f, ...
 *
 *        if (consts[r].test(input.charAt(currPos))) {
 *          interpret(ip + 4, ip + 4 + a);
 *        } else {
 *          interpret(ip + 4 + a, ip + 4 + a + f);
 *        }
 *
 * [17] ACCEPT_N n
 *
 *        stack.push(input.substring(currPos, n));
 *        currPos += n;
 *
 * [18] ACCEPT_STRING s
 *
 *        stack.push(consts[s]);
 *        currPos += consts[s].length;
 *
 * [19] FAIL e
 *
 *        stack.push(FAILED);
 *        fail(consts[e]);
 *
 * Calls
 * -----
 *
 * [20] REPORT_SAVED_POS p
 *
 *        reportedPos = stack[p];
 *
 * [21] REPORT_CURR_POS
 *
 *        reportedPos = currPos;
 *
 * [22] CALL f, n, pc, p1, p2, ..., pN
 *
 *        value = consts[f](stack[p1], ..., stack[pN]);
 *        stack.pop(n);
 *        stack.push(value);
 *
 * Rules
 * -----
 *
 * [23] RULE r
 *
 *        stack.push(parseRule(r));
 *
 * Failure Reporting
 * -----------------
 *
 * [24] SILENT_FAILS_ON
 *
 *        silentFails++;
 *
 * [25] SILENT_FAILS_OFF
 *
 *        silentFails--;
 */
module.exports = function(ast) {
  var consts = [];

  function addConst(value) {
    var index = utils.indexOf(consts, function(c) { return c === value; });

    return index === -1 ? consts.push(value) - 1 : index;
  }

  function addFunctionConst(params, code) {
    return addConst(
      "function(" + params.join(", ") + ") {" + code + "}"
    );
  }

  function buildSequence() {
    return Array.prototype.concat.apply([], arguments);
  }

  function buildCondition(condCode, thenCode, elseCode) {
    return condCode.concat(
      [thenCode.length, elseCode.length],
      thenCode,
      elseCode
    );
  }

  function buildLoop(condCode, bodyCode) {
    return condCode.concat([bodyCode.length], bodyCode);
  }

  function buildCall(functionIndex, delta, env, sp) {
    var params = utils.map( utils.values(env), function(p) { return sp - p; });

    return [op.CALL, functionIndex, delta, params.length].concat(params);
  }

  function buildSimplePredicate(expression, negative, context) {
    var undefinedIndex = addConst('void 0'),
        failedIndex    = addConst('peg$FAILED');

    return buildSequence(
      [op.PUSH_CURR_POS],
      [op.SILENT_FAILS_ON],
      generate(expression, {
        sp:     context.sp + 1,
        env:    { },
        action: null
      }),
      [op.SILENT_FAILS_OFF],
      buildCondition(
        [negative ? op.IF_ERROR : op.IF_NOT_ERROR],
        buildSequence(
          [op.POP],
          [negative ? op.POP : op.POP_CURR_POS],
          [op.PUSH, undefinedIndex]
        ),
        buildSequence(
          [op.POP],
          [negative ? op.POP_CURR_POS : op.POP],
          [op.PUSH, failedIndex]
        )
      )
    );
  }

  function buildSemanticPredicate(code, negative, context) {
    var functionIndex  = addFunctionConst(utils.keys(context.env), code),
        undefinedIndex = addConst('void 0'),
        failedIndex    = addConst('peg$FAILED');

    return buildSequence(
      [op.REPORT_CURR_POS],
      buildCall(functionIndex, 0, context.env, context.sp),
      buildCondition(
        [op.IF],
        buildSequence(
          [op.POP],
          [op.PUSH, negative ? failedIndex : undefinedIndex]
        ),
        buildSequence(
          [op.POP],
          [op.PUSH, negative ? undefinedIndex : failedIndex]
        )
      )
    );
  }

  function buildAppendLoop(expressionCode) {
    return buildLoop(
      [op.WHILE_NOT_ERROR],
      buildSequence([op.APPEND], expressionCode)
    );
  }

  var generate = utils.buildNodeVisitor({
    grammar: function(node) {
      utils.each(node.rules, generate);

      node.consts = consts;
    },

    rule: function(node) {
      node.bytecode = generate(node.expression, {
        sp:     -1,  // stack pointer
        env:    { }, // mapping of label names to stack positions
        action: null // action nodes pass themselves to children here
      });
    },

    named: function(node, context) {
      var nameIndex = addConst(
        '{ type: "other", description: ' + utils.quote(node.name) + ' }'
      );

      /*
       * The code generated below is slightly suboptimal because |FAIL| pushes
       * to the stack, so we need to stick a |POP| in front of it. We lack a
       * dedicated instruction that would just report the failure and not touch
       * the stack.
       */
      return buildSequence(
        [op.SILENT_FAILS_ON],
        generate(node.expression, context),
        [op.SILENT_FAILS_OFF],
        buildCondition([op.IF_ERROR], [op.FAIL, nameIndex], [])
      );
    },

    choice: function(node, context) {
      function buildAlternativesCode(alternatives, context) {
        return buildSequence(
          generate(alternatives[0], {
            sp:     context.sp,
            env:    { },
            action: null
          }),
          alternatives.length > 1
            ? buildCondition(
                [op.IF_ERROR],
                buildSequence(
                  [op.POP],
                  buildAlternativesCode(alternatives.slice(1), context)
                ),
                []
              )
            : []
        );
      }

      return buildAlternativesCode(node.alternatives, context);
    },

    action: function(node, context) {
      var env            = { },
          emitCall       = node.expression.type !== "sequence"
                        || node.expression.elements.length === 0,
          expressionCode = generate(node.expression, {
            sp:     context.sp + (emitCall ? 1 : 0),
            env:    env,
            action: node
          }),
          functionIndex  = addFunctionConst(utils.keys(env), node.code);

      return emitCall
        ? buildSequence(
            [op.PUSH_CURR_POS],
            expressionCode,
            buildCondition(
              [op.IF_NOT_ERROR],
              buildSequence(
                [op.REPORT_SAVED_POS, 1],
                buildCall(functionIndex, 1, env, context.sp + 2)
              ),
              []
            ),
            [op.NIP]
          )
        : expressionCode;
    },

    sequence: function(node, context) {
      var emptyArrayIndex;

      function buildElementsCode(elements, context) {
        var processedCount, functionIndex;

        if (elements.length > 0) {
          processedCount = node.elements.length - elements.slice(1).length;

          return buildSequence(
            generate(elements[0], {
              sp:     context.sp,
              env:    context.env,
              action: null
            }),
            buildCondition(
              [op.IF_NOT_ERROR],
              buildElementsCode(elements.slice(1), {
                sp:     context.sp + 1,
                env:    context.env,
                action: context.action
              }),
              buildSequence(
                processedCount > 1 ? [op.POP_N, processedCount] : [op.POP],
                [op.POP_CURR_POS],
                [op.PUSH, failedIndex]
              )
            )
          );
        } else {
          if (context.action) {
            functionIndex = addFunctionConst(
              utils.keys(context.env),
              context.action.code
            );

            return buildSequence(
              [op.REPORT_SAVED_POS, node.elements.length],
              buildCall(
                functionIndex,
                node.elements.length,
                context.env,
                context.sp
              ),
              [op.NIP]
            );
          } else {
            return buildSequence([op.WRAP, node.elements.length], [op.NIP]);
          }
        }
      }

      if (node.elements.length > 0) {
        failedIndex = addConst('peg$FAILED');

        return buildSequence(
          [op.PUSH_CURR_POS],
          buildElementsCode(node.elements, {
            sp:     context.sp + 1,
            env:    context.env,
            action: context.action
          })
        );
      } else {
        emptyArrayIndex = addConst('[]');

        return [op.PUSH, emptyArrayIndex];
      }
    },

    labeled: function(node, context) {
      context.env[node.label] = context.sp + 1;

      return generate(node.expression, {
        sp:     context.sp,
        env:    { },
        action: null
      });
    },

    text: function(node, context) {
      return buildSequence(
        [op.PUSH_CURR_POS],
        generate(node.expression, {
          sp:     context.sp + 1,
          env:    { },
          action: null
        }),
        buildCondition([op.IF_NOT_ERROR], [op.TEXT], []),
        [op.NIP]
      );
    },

    simple_and: function(node, context) {
      return buildSimplePredicate(node.expression, false, context);
    },

    simple_not: function(node, context) {
      return buildSimplePredicate(node.expression, true, context);
    },

    semantic_and: function(node, context) {
      return buildSemanticPredicate(node.code, false, context);
    },

    semantic_not: function(node, context) {
      return buildSemanticPredicate(node.code, true, context);
    },

    optional: function(node, context) {
      var nullIndex = addConst('null');

      return buildSequence(
        generate(node.expression, {
          sp:     context.sp,
          env:    { },
          action: null
        }),
        buildCondition(
          [op.IF_ERROR],
          buildSequence([op.POP], [op.PUSH, nullIndex]),
          []
        )
      );
    },

    zero_or_more: function(node, context) {
      var emptyArrayIndex = addConst('[]');
          expressionCode  = generate(node.expression, {
            sp:     context.sp + 1,
            env:    { },
            action: null
          });

      return buildSequence(
        [op.PUSH, emptyArrayIndex],
        expressionCode,
        buildAppendLoop(expressionCode),
        [op.POP]
      );
    },

    one_or_more: function(node, context) {
      var emptyArrayIndex = addConst('[]');
          failedIndex     = addConst('peg$FAILED');
          expressionCode  = generate(node.expression, {
            sp:     context.sp + 1,
            env:    { },
            action: null
          });

      return buildSequence(
        [op.PUSH, emptyArrayIndex],
        expressionCode,
        buildCondition(
          [op.IF_NOT_ERROR],
          buildSequence(buildAppendLoop(expressionCode), [op.POP]),
          buildSequence([op.POP], [op.POP], [op.PUSH, failedIndex])
        )
      );
    },

    rule_ref: function(node) {
      return [op.RULE, utils.indexOfRuleByName(ast, node.name)];
    },

    literal: function(node) {
      var stringIndex, expectedIndex;

      if (node.value.length > 0) {
        stringIndex = addConst(node.ignoreCase
          ? utils.quote(node.value.toLowerCase())
          : utils.quote(node.value)
        );
        expectedIndex = addConst([
          '{',
          'type: "literal",',
          'value: ' + utils.quote(node.value) + ',',
          'description: ' + utils.quote(utils.quote(node.value)),
          '}'
        ].join(' '));

        /*
         * For case-sensitive strings the value must match the beginning of the
         * remaining input exactly. As a result, we can use |ACCEPT_STRING| and
         * save one |substr| call that would be needed if we used |ACCEPT_N|.
         */
        return buildCondition(
          node.ignoreCase
            ? [op.MATCH_STRING_IC, stringIndex]
            : [op.MATCH_STRING, stringIndex],
          node.ignoreCase
            ? [op.ACCEPT_N, node.value.length]
            : [op.ACCEPT_STRING, stringIndex],
          [op.FAIL, expectedIndex]
        );
      } else {
        stringIndex = addConst('""');

        return [op.PUSH, stringIndex];
      }
    },

    "class": function(node) {
      var regexp, regexpIndex, expectedIndex;

      if (node.parts.length > 0) {
        regexp = '/^['
          + (node.inverted ? '^' : '')
          + utils.map(node.parts, function(part) {
              return part instanceof Array
                ? utils.quoteForRegexpClass(part[0])
                  + '-'
                  + utils.quoteForRegexpClass(part[1])
                : utils.quoteForRegexpClass(part);
            }).join('')
          + ']/' + (node.ignoreCase ? 'i' : '');
      } else {
        /*
         * IE considers regexps /[]/ and /[^]/ as syntactically invalid, so we
         * translate them into euqivalents it can handle.
         */
        regexp = node.inverted ? '/^[\\S\\s]/' : '/^(?!)/';
      }

      regexpIndex   = addConst(regexp);
      expectedIndex = addConst([
        '{',
        'type: "class",',
        'value: ' + utils.quote(node.rawText) + ',',
        'description: ' + utils.quote(node.rawText),
        '}'
      ].join(' '));

      return buildCondition(
        [op.MATCH_REGEXP, regexpIndex],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    },

    any: function() {
      var expectedIndex = addConst('{ type: "any", description: "any character" }');

      return buildCondition(
        [op.MATCH_ANY],
        [op.ACCEPT_N, 1],
        [op.FAIL, expectedIndex]
      );
    }
  });

  generate(ast);
};

},{"../../utils":19,"../opcodes":10}],12:[function(require,module,exports){
var utils = require("../../utils"),
    op    = require("../opcodes");

/* Generates parser JavaScript code. */
module.exports = function(ast, options) {
  /* These only indent non-empty lines to avoid trailing whitespace. */
  function indent2(code)  { return code.replace(/^(.+)$/gm, '  $1');         }
  function indent4(code)  { return code.replace(/^(.+)$/gm, '    $1');       }
  function indent8(code)  { return code.replace(/^(.+)$/gm, '        $1');   }
  function indent10(code) { return code.replace(/^(.+)$/gm, '          $1'); }

  function generateTables() {
    if (options.optimize === "size") {
      return [
        'peg$consts = [',
           indent2(ast.consts.join(',\n')),
        '],',
        '',
        'peg$bytecode = [',
           indent2(utils.map(
             ast.rules,
             function(rule) {
               return 'peg$decode('
                     + utils.quote(utils.map(
                         rule.bytecode,
                         function(b) { return String.fromCharCode(b + 32); }
                       ).join(''))
                     + ')';
             }
           ).join(',\n')),
        '],'
      ].join('\n');
    } else {
      return utils.map(
        ast.consts,
        function(c, i) { return 'peg$c' + i + ' = ' + c + ','; }
      ).join('\n');
    }
  }

  function generateCacheHeader(ruleIndexCode) {
    return [
      'var key    = peg$currPos * ' + ast.rules.length + ' + ' + ruleIndexCode + ',',
      '    cached = peg$cache[key];',
      '',
      'if (cached) {',
      '  peg$currPos = cached.nextPos;',
      '  return cached.result;',
      '}',
      ''
    ].join('\n');
  }

  function generateCacheFooter(resultCode) {
    return [
      '',
      'peg$cache[key] = { nextPos: peg$currPos, result: ' + resultCode + ' };'
    ].join('\n');
  }

  function generateInterpreter() {
    var parts = [];

    function generateCondition(cond, argsLength) {
      var baseLength      = argsLength + 3,
          thenLengthCode = 'bc[ip + ' + (baseLength - 2) + ']',
          elseLengthCode = 'bc[ip + ' + (baseLength - 1) + ']';

      return [
        'ends.push(end);',
        'ips.push(ip + ' + baseLength + ' + ' + thenLengthCode + ' + ' + elseLengthCode + ');',
        '',
        'if (' + cond + ') {',
        '  end = ip + ' + baseLength + ' + ' + thenLengthCode + ';',
        '  ip += ' + baseLength + ';',
        '} else {',
        '  end = ip + ' + baseLength + ' + ' + thenLengthCode + ' + ' + elseLengthCode + ';',
        '  ip += ' + baseLength + ' + ' + thenLengthCode + ';',
        '}',
        '',
        'break;'
      ].join('\n');
    }

    function generateLoop(cond) {
      var baseLength     = 2,
          bodyLengthCode = 'bc[ip + ' + (baseLength - 1) + ']';

      return [
        'if (' + cond + ') {',
        '  ends.push(end);',
        '  ips.push(ip);',
        '',
        '  end = ip + ' + baseLength + ' + ' + bodyLengthCode + ';',
        '  ip += ' + baseLength + ';',
        '} else {',
        '  ip += ' + baseLength + ' + ' + bodyLengthCode + ';',
        '}',
        '',
        'break;'
      ].join('\n');
    }

    function generateCall() {
      var baseLength       = 4,
          paramsLengthCode = 'bc[ip + ' + (baseLength - 1) + ']';

      return [
        'params = bc.slice(ip + ' + baseLength + ', ip + ' + baseLength + ' + ' + paramsLengthCode + ');',
        'for (i = 0; i < ' + paramsLengthCode + '; i++) {',
        '  params[i] = stack[stack.length - 1 - params[i]];',
        '}',
        '',
        'stack.splice(',
        '  stack.length - bc[ip + 2],',
        '  bc[ip + 2],',
        '  peg$consts[bc[ip + 1]].apply(null, params)',
        ');',
        '',
        'ip += ' + baseLength + ' + ' + paramsLengthCode + ';',
        'break;'
      ].join('\n');
    }

    parts.push([
      'function peg$decode(s) {',
      '  var bc = new Array(s.length), i;',
      '',
      '  for (i = 0; i < s.length; i++) {',
      '    bc[i] = s.charCodeAt(i) - 32;',
      '  }',
      '',
      '  return bc;',
      '}',
      '',
      'function peg$parseRule(index) {',
      '  var bc    = peg$bytecode[index],',
      '      ip    = 0,',
      '      ips   = [],',
      '      end   = bc.length,',
      '      ends  = [],',
      '      stack = [],',
      '      params, i;',
      ''
    ].join('\n'));

    if (options.cache) {
      parts.push(indent2(generateCacheHeader('index')));
    }

    parts.push([
      '  function protect(object) {',
      '    return Object.prototype.toString.apply(object) === "[object Array]" ? [] : object;',
      '  }',
      '',
      /*
       * The point of the outer loop and the |ips| & |ends| stacks is to avoid
       * recursive calls for interpreting parts of bytecode. In other words, we
       * implement the |interpret| operation of the abstract machine without
       * function calls. Such calls would likely slow the parser down and more
       * importantly cause stack overflows for complex grammars.
       */
      '  while (true) {',
      '    while (ip < end) {',
      '      switch (bc[ip]) {',
      '        case ' + op.PUSH + ':',             // PUSH c
      /*
       * Hack: One of the constants can be an empty array. It needs to be cloned
       * because it can be modified later on the stack by |APPEND|.
       */
      '          stack.push(protect(peg$consts[bc[ip + 1]]));',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.PUSH_CURR_POS + ':',    // PUSH_CURR_POS
      '          stack.push(peg$currPos);',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.POP + ':',              // POP
      '          stack.pop();',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.POP_CURR_POS + ':',     // POP_CURR_POS
      '          peg$currPos = stack.pop();',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.POP_N + ':',            // POP_N n
      '          stack.length -= bc[ip + 1];',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.NIP + ':',              // NIP
      '          stack.splice(-2, 1);',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.APPEND + ':',           // APPEND
      '          stack[stack.length - 2].push(stack.pop());',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.WRAP + ':',             // WRAP n
      '          stack.push(stack.splice(stack.length - bc[ip + 1], bc[ip + 1]));',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.TEXT + ':',             // TEXT
      '          stack.pop();',
      '          stack.push(input.substring(stack[stack.length - 1], peg$currPos));',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.IF + ':',               // IF t, f
                 indent10(generateCondition('stack[stack.length - 1]', 0)),
      '',
      '        case ' + op.IF_ERROR + ':',         // IF_ERROR t, f
                 indent10(generateCondition(
                   'stack[stack.length - 1] === peg$FAILED',
                   0
                 )),
      '',
      '        case ' + op.IF_NOT_ERROR + ':',     // IF_NOT_ERROR t, f
                 indent10(
                   generateCondition('stack[stack.length - 1] !== peg$FAILED',
                   0
                 )),
      '',
      '        case ' + op.WHILE_NOT_ERROR + ':',  // WHILE_NOT_ERROR b
                 indent10(generateLoop('stack[stack.length - 1] !== peg$FAILED')),
      '',
      '        case ' + op.MATCH_ANY + ':',        // MATCH_ANY a, f, ...
                 indent10(generateCondition('input.length > peg$currPos', 0)),
      '',
      '        case ' + op.MATCH_STRING + ':',     // MATCH_STRING s, a, f, ...
                 indent10(generateCondition(
                   'input.substr(peg$currPos, peg$consts[bc[ip + 1]].length) === peg$consts[bc[ip + 1]]',
                   1
                 )),
      '',
      '        case ' + op.MATCH_STRING_IC + ':',  // MATCH_STRING_IC s, a, f, ...
                 indent10(generateCondition(
                   'input.substr(peg$currPos, peg$consts[bc[ip + 1]].length).toLowerCase() === peg$consts[bc[ip + 1]]',
                   1
                 )),
      '',
      '        case ' + op.MATCH_REGEXP + ':',     // MATCH_REGEXP r, a, f, ...
                 indent10(generateCondition(
                   'peg$consts[bc[ip + 1]].test(input.charAt(peg$currPos))',
                   1
                 )),
      '',
      '        case ' + op.ACCEPT_N + ':',         // ACCEPT_N n
      '          stack.push(input.substr(peg$currPos, bc[ip + 1]));',
      '          peg$currPos += bc[ip + 1];',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.ACCEPT_STRING + ':',    // ACCEPT_STRING s
      '          stack.push(peg$consts[bc[ip + 1]]);',
      '          peg$currPos += peg$consts[bc[ip + 1]].length;',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.FAIL + ':',             // FAIL e
      '          stack.push(peg$FAILED);',
      '          if (peg$silentFails === 0) {',
      '            peg$fail(peg$consts[bc[ip + 1]]);',
      '          }',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.REPORT_SAVED_POS + ':', // REPORT_SAVED_POS p
      '          peg$reportedPos = stack[stack.length - 1 - bc[ip + 1]];',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.REPORT_CURR_POS + ':',  // REPORT_CURR_POS
      '          peg$reportedPos = peg$currPos;',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.CALL + ':',             // CALL f, n, pc, p1, p2, ..., pN
                 indent10(generateCall()),
      '',
      '        case ' + op.RULE + ':',             // RULE r
      '          stack.push(peg$parseRule(bc[ip + 1]));',
      '          ip += 2;',
      '          break;',
      '',
      '        case ' + op.SILENT_FAILS_ON + ':',  // SILENT_FAILS_ON
      '          peg$silentFails++;',
      '          ip++;',
      '          break;',
      '',
      '        case ' + op.SILENT_FAILS_OFF + ':', // SILENT_FAILS_OFF
      '          peg$silentFails--;',
      '          ip++;',
      '          break;',
      '',
      '        default:',
      '          throw new Error("Invalid opcode: " + bc[ip] + ".");',
      '      }',
      '    }',
      '',
      '    if (ends.length > 0) {',
      '      end = ends.pop();',
      '      ip = ips.pop();',
      '    } else {',
      '      break;',
      '    }',
      '  }'
    ].join('\n'));

    if (options.cache) {
      parts.push(indent2(generateCacheFooter('stack[0]')));
    }

    parts.push([
      '',
      '  return stack[0];',
      '}'
    ].join('\n'));

    return parts.join('\n');
  }

  function generateRuleFunction(rule) {
    var parts = [], code;

    function c(i) { return "peg$c" + i; } // |consts[i]| of the abstract machine
    function s(i) { return "s"     + i; } // |stack[i]| of the abstract machine

    var stack = {
          sp:    -1,
          maxSp: -1,

          push: function(exprCode) {
            var code = s(++this.sp) + ' = ' + exprCode + ';';

            if (this.sp > this.maxSp) { this.maxSp = this.sp; }

            return code;
          },

          pop: function() {
            var n, values;

            if (arguments.length === 0) {
              return s(this.sp--);
            } else {
              n = arguments[0];
              values = utils.map(utils.range(this.sp - n + 1, this.sp + 1), s);
              this.sp -= n;

              return values;
            }
          },

          top: function() {
            return s(this.sp);
          },

          index: function(i) {
            return s(this.sp - i);
          }
        };

    function compile(bc) {
      var ip    = 0,
          end   = bc.length,
          parts = [],
          value;

      function compileCondition(cond, argCount) {
        var baseLength = argCount + 3,
            thenLength = bc[ip + baseLength - 2],
            elseLength = bc[ip + baseLength - 1],
            baseSp     = stack.sp,
            thenCode, elseCode, thenSp, elseSp;

        ip += baseLength;
        thenCode = compile(bc.slice(ip, ip + thenLength));
        thenSp = stack.sp;
        ip += thenLength;

        if (elseLength > 0) {
          stack.sp = baseSp;
          elseCode = compile(bc.slice(ip, ip + elseLength));
          elseSp = stack.sp;
          ip += elseLength;

          if (thenSp !== elseSp) {
            throw new Error(
              "Branches of a condition must move the stack pointer in the same way."
            );
          }
        }

        parts.push('if (' + cond + ') {');
        parts.push(indent2(thenCode));
        if (elseLength > 0) {
          parts.push('} else {');
          parts.push(indent2(elseCode));
        }
        parts.push('}');
      }

      function compileLoop(cond) {
        var baseLength = 2,
            bodyLength = bc[ip + baseLength - 1],
            baseSp     = stack.sp,
            bodyCode, bodySp;

        ip += baseLength;
        bodyCode = compile(bc.slice(ip, ip + bodyLength));
        bodySp = stack.sp;
        ip += bodyLength;

        if (bodySp !== baseSp) {
          throw new Error("Body of a loop can't move the stack pointer.");
        }

        parts.push('while (' + cond + ') {');
        parts.push(indent2(bodyCode));
        parts.push('}');
      }

      function compileCall() {
        var baseLength   = 4,
            paramsLength = bc[ip + baseLength - 1];

        var value = c(bc[ip + 1]) + '('
              + utils.map(
                  bc.slice(ip + baseLength, ip + baseLength + paramsLength),
                  stackIndex
                ).join(', ')
              + ')';
        stack.pop(bc[ip + 2]);
        parts.push(stack.push(value));
        ip += baseLength + paramsLength;
      }

      /*
       * Extracted into a function just to silence JSHint complaining about
       * creating functions in a loop.
       */
      function stackIndex(p) {
        return stack.index(p);
      }

      while (ip < end) {
        switch (bc[ip]) {
          case op.PUSH:             // PUSH c
            /*
             * Hack: One of the constants can be an empty array. It needs to be
             * handled specially because it can be modified later on the stack
             * by |APPEND|.
             */
            parts.push(
              stack.push(ast.consts[bc[ip + 1]] === "[]" ? "[]" : c(bc[ip + 1]))
            );
            ip += 2;
            break;

          case op.PUSH_CURR_POS:    // PUSH_CURR_POS
            parts.push(stack.push('peg$currPos'));
            ip++;
            break;

          case op.POP:              // POP
            stack.pop();
            ip++;
            break;

          case op.POP_CURR_POS:     // POP_CURR_POS
            parts.push('peg$currPos = ' + stack.pop() + ';');
            ip++;
            break;

          case op.POP_N:            // POP_N n
            stack.pop(bc[ip + 1]);
            ip += 2;
            break;

          case op.NIP:              // NIP
            value = stack.pop();
            stack.pop();
            parts.push(stack.push(value));
            ip++;
            break;

          case op.APPEND:           // APPEND
            value = stack.pop();
            parts.push(stack.top() + '.push(' + value + ');');
            ip++;
            break;

          case op.WRAP:             // WRAP n
            parts.push(
              stack.push('[' + stack.pop(bc[ip + 1]).join(', ') + ']')
            );
            ip += 2;
            break;

          case op.TEXT:             // TEXT
            stack.pop();
            parts.push(
              stack.push('input.substring(' + stack.top() + ', peg$currPos)')
            );
            ip++;
            break;

          case op.IF:               // IF t, f
            compileCondition(stack.top(), 0);
            break;

          case op.IF_ERROR:         // IF_ERROR t, f
            compileCondition(stack.top() + ' === peg$FAILED', 0);
            break;

          case op.IF_NOT_ERROR:     // IF_NOT_ERROR t, f
            compileCondition(stack.top() + ' !== peg$FAILED', 0);
            break;

          case op.WHILE_NOT_ERROR:  // WHILE_NOT_ERROR b
            compileLoop(stack.top() + ' !== peg$FAILED', 0);
            break;

          case op.MATCH_ANY:        // MATCH_ANY a, f, ...
            compileCondition('input.length > peg$currPos', 0);
            break;

          case op.MATCH_STRING:     // MATCH_STRING s, a, f, ...
            compileCondition(
              eval(ast.consts[bc[ip + 1]]).length > 1
                ? 'input.substr(peg$currPos, '
                    + eval(ast.consts[bc[ip + 1]]).length
                    + ') === '
                    + c(bc[ip + 1])
                : 'input.charCodeAt(peg$currPos) === '
                    + eval(ast.consts[bc[ip + 1]]).charCodeAt(0),
              1
            );
            break;

          case op.MATCH_STRING_IC:  // MATCH_STRING_IC s, a, f, ...
            compileCondition(
              'input.substr(peg$currPos, '
                + eval(ast.consts[bc[ip + 1]]).length
                + ').toLowerCase() === '
                + c(bc[ip + 1]),
              1
            );
            break;

          case op.MATCH_REGEXP:     // MATCH_REGEXP r, a, f, ...
            compileCondition(
              c(bc[ip + 1]) + '.test(input.charAt(peg$currPos))',
              1
            );
            break;

          case op.ACCEPT_N:         // ACCEPT_N n
            parts.push(stack.push(
              bc[ip + 1] > 1
                ? 'input.substr(peg$currPos, ' + bc[ip + 1] + ')'
                : 'input.charAt(peg$currPos)'
            ));
            parts.push(
              bc[ip + 1] > 1
                ? 'peg$currPos += ' + bc[ip + 1] + ';'
                : 'peg$currPos++;'
            );
            ip += 2;
            break;

          case op.ACCEPT_STRING:    // ACCEPT_STRING s
            parts.push(stack.push(c(bc[ip + 1])));
            parts.push(
              eval(ast.consts[bc[ip + 1]]).length > 1
                ? 'peg$currPos += ' + eval(ast.consts[bc[ip + 1]]).length + ';'
                : 'peg$currPos++;'
            );
            ip += 2;
            break;

          case op.FAIL:             // FAIL e
            parts.push(stack.push('peg$FAILED'));
            parts.push('if (peg$silentFails === 0) { peg$fail(' + c(bc[ip + 1]) + '); }');
            ip += 2;
            break;

          case op.REPORT_SAVED_POS: // REPORT_SAVED_POS p
            parts.push('peg$reportedPos = ' + stack.index(bc[ip + 1]) + ';');
            ip += 2;
            break;

          case op.REPORT_CURR_POS:  // REPORT_CURR_POS
            parts.push('peg$reportedPos = peg$currPos;');
            ip++;
            break;

          case op.CALL:             // CALL f, n, pc, p1, p2, ..., pN
            compileCall();
            break;

          case op.RULE:             // RULE r
            parts.push(stack.push("peg$parse" + ast.rules[bc[ip + 1]].name + "()"));
            ip += 2;
            break;

          case op.SILENT_FAILS_ON:  // SILENT_FAILS_ON
            parts.push('peg$silentFails++;');
            ip++;
            break;

          case op.SILENT_FAILS_OFF: // SILENT_FAILS_OFF
            parts.push('peg$silentFails--;');
            ip++;
            break;

          default:
            throw new Error("Invalid opcode: " + bc[ip] + ".");
        }
      }

      return parts.join('\n');
    }

    code = compile(rule.bytecode);

    parts.push([
      'function peg$parse' + rule.name + '() {',
      '  var ' + utils.map(utils.range(0, stack.maxSp + 1), s).join(', ') + ';',
      ''
    ].join('\n'));

    if (options.cache) {
      parts.push(indent2(
        generateCacheHeader(utils.indexOfRuleByName(ast, rule.name))
      ));
    }

    parts.push(indent2(code));

    if (options.cache) {
      parts.push(indent2(generateCacheFooter(s(0))));
    }

    parts.push([
      '',
      '  return ' + s(0) + ';',
      '}'
    ].join('\n'));

    return parts.join('\n');
  }

  var parts = [],
      startRuleIndices,   startRuleIndex,
      startRuleFunctions, startRuleFunction;

  parts.push([
    '(function() {',
    '  /*',
    '   * Generated by PEG.js 0.8.0.',
    '   *',
    '   * http://pegjs.majda.cz/',
    '   */',
    '',
    '  function peg$subclass(child, parent) {',
    '    function ctor() { this.constructor = child; }',
    '    ctor.prototype = parent.prototype;',
    '    child.prototype = new ctor();',
    '  }',
    '',
    '  function SyntaxError(message, expected, found, offset, line, column) {',
    '    this.message  = message;',
    '    this.expected = expected;',
    '    this.found    = found;',
    '    this.offset   = offset;',
    '    this.line     = line;',
    '    this.column   = column;',
    '',
    '    this.name     = "SyntaxError";',
    '  }',
    '',
    '  peg$subclass(SyntaxError, Error);',
    '',
    '  function parse(input) {',
    '    var options = arguments.length > 1 ? arguments[1] : {},',
    '',
    '        peg$FAILED = {},',
    ''
  ].join('\n'));

  if (options.optimize === "size") {
    startRuleIndices = '{ '
                     + utils.map(
                         options.allowedStartRules,
                         function(r) { return r + ': ' + utils.indexOfRuleByName(ast, r); }
                       ).join(', ')
                     + ' }';
    startRuleIndex = utils.indexOfRuleByName(ast, options.allowedStartRules[0]);

    parts.push([
      '        peg$startRuleIndices = ' + startRuleIndices + ',',
      '        peg$startRuleIndex   = ' + startRuleIndex + ','
    ].join('\n'));
  } else {
    startRuleFunctions = '{ '
                     + utils.map(
                         options.allowedStartRules,
                         function(r) { return r + ': peg$parse' + r; }
                       ).join(', ')
                     + ' }';
    startRuleFunction = 'peg$parse' + options.allowedStartRules[0];

    parts.push([
      '        peg$startRuleFunctions = ' + startRuleFunctions + ',',
      '        peg$startRuleFunction  = ' + startRuleFunction + ','
    ].join('\n'));
  }

  parts.push('');

  parts.push(indent8(generateTables()));

  parts.push([
    '',
    '        peg$currPos          = 0,',
    '        peg$reportedPos      = 0,',
    '        peg$cachedPos        = 0,',
    '        peg$cachedPosDetails = { line: 1, column: 1, seenCR: false },',
    '        peg$maxFailPos       = 0,',
    '        peg$maxFailExpected  = [],',
    '        peg$silentFails      = 0,', // 0 = report failures, > 0 = silence failures
    ''
  ].join('\n'));

  if (options.cache) {
    parts.push('        peg$cache = {},');
  }

  parts.push([
    '        peg$result;',
    ''
  ].join('\n'));

  if (options.optimize === "size") {
    parts.push([
      '    if ("startRule" in options) {',
      '      if (!(options.startRule in peg$startRuleIndices)) {',
      '        throw new Error("Can\'t start parsing from rule \\"" + options.startRule + "\\".");',
      '      }',
      '',
      '      peg$startRuleIndex = peg$startRuleIndices[options.startRule];',
      '    }'
    ].join('\n'));
  } else {
    parts.push([
      '    if ("startRule" in options) {',
      '      if (!(options.startRule in peg$startRuleFunctions)) {',
      '        throw new Error("Can\'t start parsing from rule \\"" + options.startRule + "\\".");',
      '      }',
      '',
      '      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];',
      '    }'
    ].join('\n'));
  }

  parts.push([
    '',
    '    function text() {',
    '      return input.substring(peg$reportedPos, peg$currPos);',
    '    }',
    '',
    '    function offset() {',
    '      return peg$reportedPos;',
    '    }',
    '',
    '    function line() {',
    '      return peg$computePosDetails(peg$reportedPos).line;',
    '    }',
    '',
    '    function column() {',
    '      return peg$computePosDetails(peg$reportedPos).column;',
    '    }',
    '',
    '    function expected(description) {',
    '      throw peg$buildException(',
    '        null,',
    '        [{ type: "other", description: description }],',
    '        peg$reportedPos',
    '      );',
    '    }',
    '',
    '    function error(message) {',
    '      throw peg$buildException(message, null, peg$reportedPos);',
    '    }',
    '',
    '    function peg$computePosDetails(pos) {',
    '      function advance(details, startPos, endPos) {',
    '        var p, ch;',
    '',
    '        for (p = startPos; p < endPos; p++) {',
    '          ch = input.charAt(p);',
    '          if (ch === "\\n") {',
    '            if (!details.seenCR) { details.line++; }',
    '            details.column = 1;',
    '            details.seenCR = false;',
    '          } else if (ch === "\\r" || ch === "\\u2028" || ch === "\\u2029") {',
    '            details.line++;',
    '            details.column = 1;',
    '            details.seenCR = true;',
    '          } else {',
    '            details.column++;',
    '            details.seenCR = false;',
    '          }',
    '        }',
    '      }',
    '',
    '      if (peg$cachedPos !== pos) {',
    '        if (peg$cachedPos > pos) {',
    '          peg$cachedPos = 0;',
    '          peg$cachedPosDetails = { line: 1, column: 1, seenCR: false };',
    '        }',
    '        advance(peg$cachedPosDetails, peg$cachedPos, pos);',
    '        peg$cachedPos = pos;',
    '      }',
    '',
    '      return peg$cachedPosDetails;',
    '    }',
    '',
    '    function peg$fail(expected) {',
    '      if (peg$currPos < peg$maxFailPos) { return; }',
    '',
    '      if (peg$currPos > peg$maxFailPos) {',
    '        peg$maxFailPos = peg$currPos;',
    '        peg$maxFailExpected = [];',
    '      }',
    '',
    '      peg$maxFailExpected.push(expected);',
    '    }',
    '',
    '    function peg$buildException(message, expected, pos) {',
    '      function cleanupExpected(expected) {',
    '        var i = 1;',
    '',
    '        expected.sort(function(a, b) {',
    '          if (a.description < b.description) {',
    '            return -1;',
    '          } else if (a.description > b.description) {',
    '            return 1;',
    '          } else {',
    '            return 0;',
    '          }',
    '        });',
    '',
    /*
     * This works because the bytecode generator guarantees that every
     * expectation object exists only once, so it's enough to use |===| instead
     * of deeper structural comparison.
     */
    '        while (i < expected.length) {',
    '          if (expected[i - 1] === expected[i]) {',
    '            expected.splice(i, 1);',
    '          } else {',
    '            i++;',
    '          }',
    '        }',
    '      }',
    '',
    '      function buildMessage(expected, found) {',
    '        function stringEscape(s) {',
    '          function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }',
    '',
    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a string
     * literal except for the closing quote character, backslash, carriage
     * return, line separator, paragraph separator, and line feed. Any character
     * may appear in the form of an escape sequence.
     *
     * For portability, we also escape all control and non-ASCII characters.
     * Note that "\0" and "\v" escape sequences are not used because JSHint does
     * not like the first and IE the second.
     */
    '          return s',
    '            .replace(/\\\\/g,   \'\\\\\\\\\')', // backslash
    '            .replace(/"/g,    \'\\\\"\')',      // closing double quote
    '            .replace(/\\x08/g, \'\\\\b\')',     // backspace
    '            .replace(/\\t/g,   \'\\\\t\')',     // horizontal tab
    '            .replace(/\\n/g,   \'\\\\n\')',     // line feed
    '            .replace(/\\f/g,   \'\\\\f\')',     // form feed
    '            .replace(/\\r/g,   \'\\\\r\')',     // carriage return
    '            .replace(/[\\x00-\\x07\\x0B\\x0E\\x0F]/g, function(ch) { return \'\\\\x0\' + hex(ch); })',
    '            .replace(/[\\x10-\\x1F\\x80-\\xFF]/g,    function(ch) { return \'\\\\x\'  + hex(ch); })',
    '            .replace(/[\\u0180-\\u0FFF]/g,         function(ch) { return \'\\\\u0\' + hex(ch); })',
    '            .replace(/[\\u1080-\\uFFFF]/g,         function(ch) { return \'\\\\u\'  + hex(ch); });',
    '        }',
    '',
    '        var expectedDescs = new Array(expected.length),',
    '            expectedDesc, foundDesc, i;',
    '',
    '        for (i = 0; i < expected.length; i++) {',
    '          expectedDescs[i] = expected[i].description;',
    '        }',
    '',
    '        expectedDesc = expected.length > 1',
    '          ? expectedDescs.slice(0, -1).join(", ")',
    '              + " or "',
    '              + expectedDescs[expected.length - 1]',
    '          : expectedDescs[0];',
    '',
    '        foundDesc = found ? "\\"" + stringEscape(found) + "\\"" : "end of input";',
    '',
    '        return "Expected " + expectedDesc + " but " + foundDesc + " found.";',
    '      }',
    '',
    '      var posDetails = peg$computePosDetails(pos),',
    '          found      = pos < input.length ? input.charAt(pos) : null;',
    '',
    '      if (expected !== null) {',
    '        cleanupExpected(expected);',
    '      }',
    '',
    '      return new SyntaxError(',
    '        message !== null ? message : buildMessage(expected, found),',
    '        expected,',
    '        found,',
    '        pos,',
    '        posDetails.line,',
    '        posDetails.column',
    '      );',
    '    }',
    ''
  ].join('\n'));

  if (options.optimize === "size") {
    parts.push(indent4(generateInterpreter()));
    parts.push('');
  } else {
    utils.each(ast.rules, function(rule) {
      parts.push(indent4(generateRuleFunction(rule)));
      parts.push('');
    });
  }

  if (ast.initializer) {
    parts.push(indent4(ast.initializer.code));
    parts.push('');
  }

  if (options.optimize === "size") {
    parts.push('    peg$result = peg$parseRule(peg$startRuleIndex);');
  } else {
    parts.push('    peg$result = peg$startRuleFunction();');
  }

  parts.push([
    '',
    '    if (peg$result !== peg$FAILED && peg$currPos === input.length) {',
    '      return peg$result;',
    '    } else {',
    '      if (peg$result !== peg$FAILED && peg$currPos < input.length) {',
    '        peg$fail({ type: "end", description: "end of input" });',
    '      }',
    '',
    '      throw peg$buildException(null, peg$maxFailExpected, peg$maxFailPos);',
    '    }',
    '  }',
    '',
    '  return {',
    '    SyntaxError: SyntaxError,',
    '    parse:       parse',
    '  };',
    '})()'
  ].join('\n'));

  ast.code = parts.join('\n');
};

},{"../../utils":19,"../opcodes":10}],13:[function(require,module,exports){
var utils = require("../../utils");

/*
 * Removes proxy rules -- that is, rules that only delegate to other rule.
 */
module.exports = function(ast, options) {
  function isProxyRule(node) {
    return node.type === "rule" && node.expression.type === "rule_ref";
  }

  function replaceRuleRefs(ast, from, to) {
    function nop() {}

    function replaceInExpression(node, from, to) {
      replace(node.expression, from, to);
    }

    function replaceInSubnodes(propertyName) {
      return function(node, from, to) {
        utils.each(node[propertyName], function(subnode) {
          replace(subnode, from, to);
        });
      };
    }

    var replace = utils.buildNodeVisitor({
      grammar:      replaceInSubnodes("rules"),
      rule:         replaceInExpression,
      named:        replaceInExpression,
      choice:       replaceInSubnodes("alternatives"),
      sequence:     replaceInSubnodes("elements"),
      labeled:      replaceInExpression,
      text:         replaceInExpression,
      simple_and:   replaceInExpression,
      simple_not:   replaceInExpression,
      semantic_and: nop,
      semantic_not: nop,
      optional:     replaceInExpression,
      zero_or_more: replaceInExpression,
      one_or_more:  replaceInExpression,
      action:       replaceInExpression,

      rule_ref:
        function(node, from, to) {
          if (node.name === from) {
            node.name = to;
          }
        },

      literal:      nop,
      "class":      nop,
      any:          nop
    });

    replace(ast, from, to);
  }

  var indices = [];

  utils.each(ast.rules, function(rule, i) {
    if (isProxyRule(rule)) {
      replaceRuleRefs(ast, rule.name, rule.expression.name);
      if (!utils.contains(options.allowedStartRules, rule.name)) {
        indices.push(i);
      }
    }
  });

  indices.reverse();

  utils.each(indices, function(index) {
    ast.rules.splice(index, 1);
  });
};

},{"../../utils":19}],14:[function(require,module,exports){
var utils        = require("../../utils"),
    GrammarError = require("../../grammar-error");

/* Checks that no left recursion is present. */
module.exports = function(ast) {
  function nop() {}

  function checkExpression(node, appliedRules) {
    check(node.expression, appliedRules);
  }

  function checkSubnodes(propertyName) {
    return function(node, appliedRules) {
      utils.each(node[propertyName], function(subnode) {
        check(subnode, appliedRules);
      });
    };
  }

  var check = utils.buildNodeVisitor({
    grammar:     checkSubnodes("rules"),

    rule:
      function(node, appliedRules) {
        check(node.expression, appliedRules.concat(node.name));
      },

    named:       checkExpression,
    choice:      checkSubnodes("alternatives"),
    action:      checkExpression,

    sequence:
      function(node, appliedRules) {
        if (node.elements.length > 0) {
          check(node.elements[0], appliedRules);
        }
      },

    labeled:      checkExpression,
    text:         checkExpression,
    simple_and:   checkExpression,
    simple_not:   checkExpression,
    semantic_and: nop,
    semantic_not: nop,
    optional:     checkExpression,
    zero_or_more: checkExpression,
    one_or_more:  checkExpression,

    rule_ref:
      function(node, appliedRules) {
        if (utils.contains(appliedRules, node.name)) {
          throw new GrammarError(
            "Left recursion detected for rule \"" + node.name + "\"."
          );
        }
        check(utils.findRuleByName(ast, node.name), appliedRules);
      },

    literal:      nop,
    "class":      nop,
    any:          nop
  });

  check(ast, []);
};

},{"../../grammar-error":16,"../../utils":19}],15:[function(require,module,exports){
var utils        = require("../../utils"),
    GrammarError = require("../../grammar-error");

/* Checks that all referenced rules exist. */
module.exports = function(ast) {
  function nop() {}

  function checkExpression(node) { check(node.expression); }

  function checkSubnodes(propertyName) {
    return function(node) { utils.each(node[propertyName], check); };
  }

  var check = utils.buildNodeVisitor({
    grammar:      checkSubnodes("rules"),
    rule:         checkExpression,
    named:        checkExpression,
    choice:       checkSubnodes("alternatives"),
    action:       checkExpression,
    sequence:     checkSubnodes("elements"),
    labeled:      checkExpression,
    text:         checkExpression,
    simple_and:   checkExpression,
    simple_not:   checkExpression,
    semantic_and: nop,
    semantic_not: nop,
    optional:     checkExpression,
    zero_or_more: checkExpression,
    one_or_more:  checkExpression,

    rule_ref:
      function(node) {
        if (!utils.findRuleByName(ast, node.name)) {
          throw new GrammarError(
            "Referenced rule \"" + node.name + "\" does not exist."
          );
        }
      },

    literal:      nop,
    "class":      nop,
    any:          nop
  });

  check(ast);
};

},{"../../grammar-error":16,"../../utils":19}],16:[function(require,module,exports){
var utils = require("./utils");

/* Thrown when the grammar contains an error. */
module.exports = function(message) {
  this.name = "GrammarError";
  this.message = message;
};

utils.subclass(module.exports, Error);

},{"./utils":19}],17:[function(require,module,exports){
module.exports = (function() {
  /*
   * Generated by PEG.js 0.8.0.
   *
   * http://pegjs.majda.cz/
   */

  function peg$subclass(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  }

  function SyntaxError(message, expected, found, offset, line, column) {
    this.message  = message;
    this.expected = expected;
    this.found    = found;
    this.offset   = offset;
    this.line     = line;
    this.column   = column;

    this.name     = "SyntaxError";
  }

  peg$subclass(SyntaxError, Error);

  function parse(input) {
    var options = arguments.length > 1 ? arguments[1] : {},

        peg$FAILED = {},

        peg$startRuleFunctions = { grammar: peg$parsegrammar },
        peg$startRuleFunction  = peg$parsegrammar,

        peg$c0 = peg$FAILED,
        peg$c1 = null,
        peg$c2 = [],
        peg$c3 = function(initializer, rules) {
              return {
                type:        "grammar",
                initializer: initializer,
                rules:       rules
              };
            },
        peg$c4 = function(code) {
              return {
                type: "initializer",
                code: code
              };
            },
        peg$c5 = function(name, displayName, expression) {
              return {
                type:        "rule",
                name:        name,
                expression:  displayName !== null
                  ? {
                      type:       "named",
                      name:       displayName,
                      expression: expression
                    }
                  : expression
              };
            },
        peg$c6 = function(head, tail) {
              if (tail.length > 0) {
                var alternatives = [head].concat(utils.map(
                    tail,
                    function(element) { return element[1]; }
                ));
                return {
                  type:         "choice",
                  alternatives: alternatives
                };
              } else {
                return head;
              }
            },
        peg$c7 = function(elements, code) {
              var expression = elements.length !== 1
                ? {
                    type:     "sequence",
                    elements: elements
                  }
                : elements[0];
              return {
                type:       "action",
                expression: expression,
                code:       code
              };
            },
        peg$c8 = function(elements) {
              return elements.length !== 1
                ? {
                    type:     "sequence",
                    elements: elements
                  }
                : elements[0];
            },
        peg$c9 = function(label, expression) {
              return {
                type:       "labeled",
                label:      label,
                expression: expression
              };
            },
        peg$c10 = function(expression) {
              return {
                type:       "text",
                expression: expression
              };
            },
        peg$c11 = function(code) {
              return {
                type: "semantic_and",
                code: code
              };
            },
        peg$c12 = function(expression) {
              return {
                type:       "simple_and",
                expression: expression
              };
            },
        peg$c13 = function(code) {
              return {
                type: "semantic_not",
                code: code
              };
            },
        peg$c14 = function(expression) {
              return {
                type:       "simple_not",
                expression: expression
              };
            },
        peg$c15 = function(expression) {
              return {
                type:       "optional",
                expression: expression
              };
            },
        peg$c16 = function(expression) {
              return {
                type:       "zero_or_more",
                expression: expression
              };
            },
        peg$c17 = function(expression) {
              return {
                type:       "one_or_more",
                expression: expression
              };
            },
        peg$c18 = void 0,
        peg$c19 = function(name) {
              return {
                type: "rule_ref",
                name: name
              };
            },
        peg$c20 = function() { return { type: "any" }; },
        peg$c21 = function(expression) { return expression; },
        peg$c22 = { type: "other", description: "action" },
        peg$c23 = function(braced) { return braced.substr(1, braced.length - 2); },
        peg$c24 = "{",
        peg$c25 = { type: "literal", value: "{", description: "\"{\"" },
        peg$c26 = "}",
        peg$c27 = { type: "literal", value: "}", description: "\"}\"" },
        peg$c28 = /^[^{}]/,
        peg$c29 = { type: "class", value: "[^{}]", description: "[^{}]" },
        peg$c30 = "=",
        peg$c31 = { type: "literal", value: "=", description: "\"=\"" },
        peg$c32 = function() { return "="; },
        peg$c33 = ":",
        peg$c34 = { type: "literal", value: ":", description: "\":\"" },
        peg$c35 = function() { return ":"; },
        peg$c36 = ";",
        peg$c37 = { type: "literal", value: ";", description: "\";\"" },
        peg$c38 = function() { return ";"; },
        peg$c39 = "/",
        peg$c40 = { type: "literal", value: "/", description: "\"/\"" },
        peg$c41 = function() { return "/"; },
        peg$c42 = "&",
        peg$c43 = { type: "literal", value: "&", description: "\"&\"" },
        peg$c44 = function() { return "&"; },
        peg$c45 = "!",
        peg$c46 = { type: "literal", value: "!", description: "\"!\"" },
        peg$c47 = function() { return "!"; },
        peg$c48 = "$",
        peg$c49 = { type: "literal", value: "$", description: "\"$\"" },
        peg$c50 = function() { return "$"; },
        peg$c51 = "?",
        peg$c52 = { type: "literal", value: "?", description: "\"?\"" },
        peg$c53 = function() { return "?"; },
        peg$c54 = "*",
        peg$c55 = { type: "literal", value: "*", description: "\"*\"" },
        peg$c56 = function() { return "*"; },
        peg$c57 = "+",
        peg$c58 = { type: "literal", value: "+", description: "\"+\"" },
        peg$c59 = function() { return "+"; },
        peg$c60 = "(",
        peg$c61 = { type: "literal", value: "(", description: "\"(\"" },
        peg$c62 = function() { return "("; },
        peg$c63 = ")",
        peg$c64 = { type: "literal", value: ")", description: "\")\"" },
        peg$c65 = function() { return ")"; },
        peg$c66 = ".",
        peg$c67 = { type: "literal", value: ".", description: "\".\"" },
        peg$c68 = function() { return "."; },
        peg$c69 = { type: "other", description: "identifier" },
        peg$c70 = "_",
        peg$c71 = { type: "literal", value: "_", description: "\"_\"" },
        peg$c72 = function(chars) { return chars; },
        peg$c73 = { type: "other", description: "literal" },
        peg$c74 = "i",
        peg$c75 = { type: "literal", value: "i", description: "\"i\"" },
        peg$c76 = function(value, flags) {
              return {
                type:       "literal",
                value:      value,
                ignoreCase: flags === "i"
              };
            },
        peg$c77 = { type: "other", description: "string" },
        peg$c78 = function(string) { return string; },
        peg$c79 = "\"",
        peg$c80 = { type: "literal", value: "\"", description: "\"\\\"\"" },
        peg$c81 = function(chars) { return chars.join(""); },
        peg$c82 = "\\",
        peg$c83 = { type: "literal", value: "\\", description: "\"\\\\\"" },
        peg$c84 = { type: "any", description: "any character" },
        peg$c85 = function(char_) { return char_; },
        peg$c86 = "'",
        peg$c87 = { type: "literal", value: "'", description: "\"'\"" },
        peg$c88 = { type: "other", description: "character class" },
        peg$c89 = "[",
        peg$c90 = { type: "literal", value: "[", description: "\"[\"" },
        peg$c91 = "^",
        peg$c92 = { type: "literal", value: "^", description: "\"^\"" },
        peg$c93 = "]",
        peg$c94 = { type: "literal", value: "]", description: "\"]\"" },
        peg$c95 = function(inverted, parts, flags) {
              var partsConverted = utils.map(parts, function(part) { return part.data; });
              var rawText = "["
                + (inverted !== null ? inverted : "")
                + utils.map(parts, function(part) { return part.rawText; }).join("")
                + "]"
                + (flags !== null ? flags : "");

              return {
                type:       "class",
                parts:      partsConverted,
                // FIXME: Get the raw text from the input directly.
                rawText:    rawText,
                inverted:   inverted === "^",
                ignoreCase: flags === "i"
              };
            },
        peg$c96 = "-",
        peg$c97 = { type: "literal", value: "-", description: "\"-\"" },
        peg$c98 = function(begin, end) {
              if (begin.data.charCodeAt(0) > end.data.charCodeAt(0)) {
                error(
                  "Invalid character range: " + begin.rawText + "-" + end.rawText + "."
                );
              }

              return {
                data:    [begin.data, end.data],
                // FIXME: Get the raw text from the input directly.
                rawText: begin.rawText + "-" + end.rawText
              };
            },
        peg$c99 = function(char_) {
              return {
                data:    char_,
                // FIXME: Get the raw text from the input directly.
                rawText: utils.quoteForRegexpClass(char_)
              };
            },
        peg$c100 = "x",
        peg$c101 = { type: "literal", value: "x", description: "\"x\"" },
        peg$c102 = "u",
        peg$c103 = { type: "literal", value: "u", description: "\"u\"" },
        peg$c104 = function(char_) {
              return char_
                .replace("b", "\b")
                .replace("f", "\f")
                .replace("n", "\n")
                .replace("r", "\r")
                .replace("t", "\t")
                .replace("v", "\x0B"); // IE does not recognize "\v".
            },
        peg$c105 = "\\0",
        peg$c106 = { type: "literal", value: "\\0", description: "\"\\\\0\"" },
        peg$c107 = function() { return "\x00"; },
        peg$c108 = "\\x",
        peg$c109 = { type: "literal", value: "\\x", description: "\"\\\\x\"" },
        peg$c110 = function(digits) {
              return String.fromCharCode(parseInt(digits, 16));
            },
        peg$c111 = "\\u",
        peg$c112 = { type: "literal", value: "\\u", description: "\"\\\\u\"" },
        peg$c113 = function(eol) { return eol; },
        peg$c114 = /^[0-9]/,
        peg$c115 = { type: "class", value: "[0-9]", description: "[0-9]" },
        peg$c116 = /^[0-9a-fA-F]/,
        peg$c117 = { type: "class", value: "[0-9a-fA-F]", description: "[0-9a-fA-F]" },
        peg$c118 = /^[a-z]/,
        peg$c119 = { type: "class", value: "[a-z]", description: "[a-z]" },
        peg$c120 = /^[A-Z]/,
        peg$c121 = { type: "class", value: "[A-Z]", description: "[A-Z]" },
        peg$c122 = { type: "other", description: "comment" },
        peg$c123 = "//",
        peg$c124 = { type: "literal", value: "//", description: "\"//\"" },
        peg$c125 = "/*",
        peg$c126 = { type: "literal", value: "/*", description: "\"/*\"" },
        peg$c127 = "*/",
        peg$c128 = { type: "literal", value: "*/", description: "\"*/\"" },
        peg$c129 = { type: "other", description: "end of line" },
        peg$c130 = "\n",
        peg$c131 = { type: "literal", value: "\n", description: "\"\\n\"" },
        peg$c132 = "\r\n",
        peg$c133 = { type: "literal", value: "\r\n", description: "\"\\r\\n\"" },
        peg$c134 = "\r",
        peg$c135 = { type: "literal", value: "\r", description: "\"\\r\"" },
        peg$c136 = "\u2028",
        peg$c137 = { type: "literal", value: "\u2028", description: "\"\\u2028\"" },
        peg$c138 = "\u2029",
        peg$c139 = { type: "literal", value: "\u2029", description: "\"\\u2029\"" },
        peg$c140 = /^[\n\r\u2028\u2029]/,
        peg$c141 = { type: "class", value: "[\\n\\r\\u2028\\u2029]", description: "[\\n\\r\\u2028\\u2029]" },
        peg$c142 = { type: "other", description: "whitespace" },
        peg$c143 = /^[ \t\x0B\f\xA0\uFEFF\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/,
        peg$c144 = { type: "class", value: "[ \\t\\x0B\\f\\xA0\\uFEFF\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000]", description: "[ \\t\\x0B\\f\\xA0\\uFEFF\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000]" },

        peg$currPos          = 0,
        peg$reportedPos      = 0,
        peg$cachedPos        = 0,
        peg$cachedPosDetails = { line: 1, column: 1, seenCR: false },
        peg$maxFailPos       = 0,
        peg$maxFailExpected  = [],
        peg$silentFails      = 0,

        peg$result;

    if ("startRule" in options) {
      if (!(options.startRule in peg$startRuleFunctions)) {
        throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
      }

      peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
    }

    function text() {
      return input.substring(peg$reportedPos, peg$currPos);
    }

    function offset() {
      return peg$reportedPos;
    }

    function line() {
      return peg$computePosDetails(peg$reportedPos).line;
    }

    function column() {
      return peg$computePosDetails(peg$reportedPos).column;
    }

    function expected(description) {
      throw peg$buildException(
        null,
        [{ type: "other", description: description }],
        peg$reportedPos
      );
    }

    function error(message) {
      throw peg$buildException(message, null, peg$reportedPos);
    }

    function peg$computePosDetails(pos) {
      function advance(details, startPos, endPos) {
        var p, ch;

        for (p = startPos; p < endPos; p++) {
          ch = input.charAt(p);
          if (ch === "\n") {
            if (!details.seenCR) { details.line++; }
            details.column = 1;
            details.seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            details.line++;
            details.column = 1;
            details.seenCR = true;
          } else {
            details.column++;
            details.seenCR = false;
          }
        }
      }

      if (peg$cachedPos !== pos) {
        if (peg$cachedPos > pos) {
          peg$cachedPos = 0;
          peg$cachedPosDetails = { line: 1, column: 1, seenCR: false };
        }
        advance(peg$cachedPosDetails, peg$cachedPos, pos);
        peg$cachedPos = pos;
      }

      return peg$cachedPosDetails;
    }

    function peg$fail(expected) {
      if (peg$currPos < peg$maxFailPos) { return; }

      if (peg$currPos > peg$maxFailPos) {
        peg$maxFailPos = peg$currPos;
        peg$maxFailExpected = [];
      }

      peg$maxFailExpected.push(expected);
    }

    function peg$buildException(message, expected, pos) {
      function cleanupExpected(expected) {
        var i = 1;

        expected.sort(function(a, b) {
          if (a.description < b.description) {
            return -1;
          } else if (a.description > b.description) {
            return 1;
          } else {
            return 0;
          }
        });

        while (i < expected.length) {
          if (expected[i - 1] === expected[i]) {
            expected.splice(i, 1);
          } else {
            i++;
          }
        }
      }

      function buildMessage(expected, found) {
        function stringEscape(s) {
          function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }

          return s
            .replace(/\\/g,   '\\\\')
            .replace(/"/g,    '\\"')
            .replace(/\x08/g, '\\b')
            .replace(/\t/g,   '\\t')
            .replace(/\n/g,   '\\n')
            .replace(/\f/g,   '\\f')
            .replace(/\r/g,   '\\r')
            .replace(/[\x00-\x07\x0B\x0E\x0F]/g, function(ch) { return '\\x0' + hex(ch); })
            .replace(/[\x10-\x1F\x80-\xFF]/g,    function(ch) { return '\\x'  + hex(ch); })
            .replace(/[\u0180-\u0FFF]/g,         function(ch) { return '\\u0' + hex(ch); })
            .replace(/[\u1080-\uFFFF]/g,         function(ch) { return '\\u'  + hex(ch); });
        }

        var expectedDescs = new Array(expected.length),
            expectedDesc, foundDesc, i;

        for (i = 0; i < expected.length; i++) {
          expectedDescs[i] = expected[i].description;
        }

        expectedDesc = expected.length > 1
          ? expectedDescs.slice(0, -1).join(", ")
              + " or "
              + expectedDescs[expected.length - 1]
          : expectedDescs[0];

        foundDesc = found ? "\"" + stringEscape(found) + "\"" : "end of input";

        return "Expected " + expectedDesc + " but " + foundDesc + " found.";
      }

      var posDetails = peg$computePosDetails(pos),
          found      = pos < input.length ? input.charAt(pos) : null;

      if (expected !== null) {
        cleanupExpected(expected);
      }

      return new SyntaxError(
        message !== null ? message : buildMessage(expected, found),
        expected,
        found,
        pos,
        posDetails.line,
        posDetails.column
      );
    }

    function peg$parsegrammar() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$parse__();
      if (s1 !== peg$FAILED) {
        s2 = peg$parseinitializer();
        if (s2 === peg$FAILED) {
          s2 = peg$c1;
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parserule();
          if (s4 !== peg$FAILED) {
            while (s4 !== peg$FAILED) {
              s3.push(s4);
              s4 = peg$parserule();
            }
          } else {
            s3 = peg$c0;
          }
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c3(s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseinitializer() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$parseaction();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesemicolon();
        if (s2 === peg$FAILED) {
          s2 = peg$c1;
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c4(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parserule() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseidentifier();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsestring();
        if (s2 === peg$FAILED) {
          s2 = peg$c1;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseequals();
          if (s3 !== peg$FAILED) {
            s4 = peg$parsechoice();
            if (s4 !== peg$FAILED) {
              s5 = peg$parsesemicolon();
              if (s5 === peg$FAILED) {
                s5 = peg$c1;
              }
              if (s5 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c5(s1, s2, s4);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$c0;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c0;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsechoice() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parsesequence();
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$parseslash();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsesequence();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$parseslash();
          if (s4 !== peg$FAILED) {
            s5 = peg$parsesequence();
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c0;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c6(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsesequence() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parselabeled();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parselabeled();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseaction();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c7(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parselabeled();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parselabeled();
        }
        if (s1 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c8(s1);
        }
        s0 = s1;
      }

      return s0;
    }

    function peg$parselabeled() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseidentifier();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsecolon();
        if (s2 !== peg$FAILED) {
          s3 = peg$parseprefixed();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c9(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$parseprefixed();
      }

      return s0;
    }

    function peg$parseprefixed() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$parsedollar();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsesuffixed();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c10(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseand();
        if (s1 !== peg$FAILED) {
          s2 = peg$parseaction();
          if (s2 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c11(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseand();
          if (s1 !== peg$FAILED) {
            s2 = peg$parsesuffixed();
            if (s2 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c12(s2);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c0;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parsenot();
            if (s1 !== peg$FAILED) {
              s2 = peg$parseaction();
              if (s2 !== peg$FAILED) {
                peg$reportedPos = s0;
                s1 = peg$c13(s2);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$c0;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c0;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parsenot();
              if (s1 !== peg$FAILED) {
                s2 = peg$parsesuffixed();
                if (s2 !== peg$FAILED) {
                  peg$reportedPos = s0;
                  s1 = peg$c14(s2);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$c0;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c0;
              }
              if (s0 === peg$FAILED) {
                s0 = peg$parsesuffixed();
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesuffixed() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$parseprimary();
      if (s1 !== peg$FAILED) {
        s2 = peg$parsequestion();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c15(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseprimary();
        if (s1 !== peg$FAILED) {
          s2 = peg$parsestar();
          if (s2 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c16(s1);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseprimary();
          if (s1 !== peg$FAILED) {
            s2 = peg$parseplus();
            if (s2 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c17(s1);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$c0;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$parseprimary();
          }
        }
      }

      return s0;
    }

    function peg$parseprimary() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      s1 = peg$parseidentifier();
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        peg$silentFails++;
        s3 = peg$currPos;
        s4 = peg$parsestring();
        if (s4 === peg$FAILED) {
          s4 = peg$c1;
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parseequals();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = peg$c18;
        } else {
          peg$currPos = s2;
          s2 = peg$c0;
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c19(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$parseliteral();
        if (s0 === peg$FAILED) {
          s0 = peg$parseclass();
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parsedot();
            if (s1 !== peg$FAILED) {
              peg$reportedPos = s0;
              s1 = peg$c20();
            }
            s0 = s1;
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parselparen();
              if (s1 !== peg$FAILED) {
                s2 = peg$parsechoice();
                if (s2 !== peg$FAILED) {
                  s3 = peg$parserparen();
                  if (s3 !== peg$FAILED) {
                    peg$reportedPos = s0;
                    s1 = peg$c21(s2);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$c0;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$c0;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c0;
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parseaction() {
      var s0, s1, s2;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsebraced();
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c23(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c22); }
      }

      return s0;
    }

    function peg$parsebraced() {
      var s0, s1, s2, s3, s4;

      s0 = peg$currPos;
      s1 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 123) {
        s2 = peg$c24;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c25); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parsebraced();
        if (s4 === peg$FAILED) {
          s4 = peg$parsenonBraceCharacters();
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parsebraced();
          if (s4 === peg$FAILED) {
            s4 = peg$parsenonBraceCharacters();
          }
        }
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 125) {
            s4 = peg$c26;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c27); }
          }
          if (s4 !== peg$FAILED) {
            s2 = [s2, s3, s4];
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$c0;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$c0;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$c0;
      }
      if (s1 !== peg$FAILED) {
        s1 = input.substring(s0, peg$currPos);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsenonBraceCharacters() {
      var s0, s1;

      s0 = [];
      s1 = peg$parsenonBraceCharacter();
      if (s1 !== peg$FAILED) {
        while (s1 !== peg$FAILED) {
          s0.push(s1);
          s1 = peg$parsenonBraceCharacter();
        }
      } else {
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsenonBraceCharacter() {
      var s0;

      if (peg$c28.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c29); }
      }

      return s0;
    }

    function peg$parseequals() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 61) {
        s1 = peg$c30;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c31); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c32();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsecolon() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 58) {
        s1 = peg$c33;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c34); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c35();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsesemicolon() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 59) {
        s1 = peg$c36;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c37); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c38();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseslash() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 47) {
        s1 = peg$c39;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c40); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c41();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseand() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 38) {
        s1 = peg$c42;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c43); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c44();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsenot() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 33) {
        s1 = peg$c45;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c46); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c47();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsedollar() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 36) {
        s1 = peg$c48;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c49); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c50();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsequestion() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 63) {
        s1 = peg$c51;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c52); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c53();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsestar() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 42) {
        s1 = peg$c54;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c55); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c56();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseplus() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 43) {
        s1 = peg$c57;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c58); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c59();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parselparen() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c60;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c61); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c62();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parserparen() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 41) {
        s1 = peg$c63;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c64); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c65();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsedot() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 46) {
        s1 = peg$c66;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c67); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c68();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseidentifier() {
      var s0, s1, s2, s3, s4, s5;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$currPos;
      s2 = peg$currPos;
      s3 = peg$parseletter();
      if (s3 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 95) {
          s3 = peg$c70;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c71); }
        }
      }
      if (s3 !== peg$FAILED) {
        s4 = [];
        s5 = peg$parseletter();
        if (s5 === peg$FAILED) {
          s5 = peg$parsedigit();
          if (s5 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 95) {
              s5 = peg$c70;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c71); }
            }
          }
        }
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseletter();
          if (s5 === peg$FAILED) {
            s5 = peg$parsedigit();
            if (s5 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 95) {
                s5 = peg$c70;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c71); }
              }
            }
          }
        }
        if (s4 !== peg$FAILED) {
          s3 = [s3, s4];
          s2 = s3;
        } else {
          peg$currPos = s2;
          s2 = peg$c0;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$c0;
      }
      if (s2 !== peg$FAILED) {
        s2 = input.substring(s1, peg$currPos);
      }
      s1 = s2;
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c72(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c69); }
      }

      return s0;
    }

    function peg$parseliteral() {
      var s0, s1, s2, s3;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsedoubleQuotedString();
      if (s1 === peg$FAILED) {
        s1 = peg$parsesingleQuotedString();
      }
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 105) {
          s2 = peg$c74;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c75); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$c1;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parse__();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c76(s1, s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c73); }
      }

      return s0;
    }

    function peg$parsestring() {
      var s0, s1, s2;

      peg$silentFails++;
      s0 = peg$currPos;
      s1 = peg$parsedoubleQuotedString();
      if (s1 === peg$FAILED) {
        s1 = peg$parsesingleQuotedString();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parse__();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c78(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c77); }
      }

      return s0;
    }

    function peg$parsedoubleQuotedString() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 34) {
        s1 = peg$c79;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c80); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsedoubleQuotedCharacter();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsedoubleQuotedCharacter();
        }
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 34) {
            s3 = peg$c79;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c80); }
          }
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c81(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsedoubleQuotedCharacter() {
      var s0;

      s0 = peg$parsesimpleDoubleQuotedCharacter();
      if (s0 === peg$FAILED) {
        s0 = peg$parsesimpleEscapeSequence();
        if (s0 === peg$FAILED) {
          s0 = peg$parsezeroEscapeSequence();
          if (s0 === peg$FAILED) {
            s0 = peg$parsehexEscapeSequence();
            if (s0 === peg$FAILED) {
              s0 = peg$parseunicodeEscapeSequence();
              if (s0 === peg$FAILED) {
                s0 = peg$parseeolEscapeSequence();
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesimpleDoubleQuotedCharacter() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 34) {
        s2 = peg$c79;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c80); }
      }
      if (s2 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 92) {
          s2 = peg$c82;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c83); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$parseeolChar();
        }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = peg$c18;
      } else {
        peg$currPos = s1;
        s1 = peg$c0;
      }
      if (s1 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c84); }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c85(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsesingleQuotedString() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 39) {
        s1 = peg$c86;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c87); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parsesingleQuotedCharacter();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parsesingleQuotedCharacter();
        }
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 39) {
            s3 = peg$c86;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c87); }
          }
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c81(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsesingleQuotedCharacter() {
      var s0;

      s0 = peg$parsesimpleSingleQuotedCharacter();
      if (s0 === peg$FAILED) {
        s0 = peg$parsesimpleEscapeSequence();
        if (s0 === peg$FAILED) {
          s0 = peg$parsezeroEscapeSequence();
          if (s0 === peg$FAILED) {
            s0 = peg$parsehexEscapeSequence();
            if (s0 === peg$FAILED) {
              s0 = peg$parseunicodeEscapeSequence();
              if (s0 === peg$FAILED) {
                s0 = peg$parseeolEscapeSequence();
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesimpleSingleQuotedCharacter() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 39) {
        s2 = peg$c86;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c87); }
      }
      if (s2 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 92) {
          s2 = peg$c82;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c83); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$parseeolChar();
        }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = peg$c18;
      } else {
        peg$currPos = s1;
        s1 = peg$c0;
      }
      if (s1 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c84); }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c85(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseclass() {
      var s0, s1, s2, s3, s4, s5, s6;

      peg$silentFails++;
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 91) {
        s1 = peg$c89;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c90); }
      }
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 94) {
          s2 = peg$c91;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c92); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$c1;
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parseclassCharacterRange();
          if (s4 === peg$FAILED) {
            s4 = peg$parseclassCharacter();
          }
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parseclassCharacterRange();
            if (s4 === peg$FAILED) {
              s4 = peg$parseclassCharacter();
            }
          }
          if (s3 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 93) {
              s4 = peg$c93;
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c94); }
            }
            if (s4 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 105) {
                s5 = peg$c74;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c75); }
              }
              if (s5 === peg$FAILED) {
                s5 = peg$c1;
              }
              if (s5 !== peg$FAILED) {
                s6 = peg$parse__();
                if (s6 !== peg$FAILED) {
                  peg$reportedPos = s0;
                  s1 = peg$c95(s2, s3, s5);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$c0;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$c0;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$c0;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c88); }
      }

      return s0;
    }

    function peg$parseclassCharacterRange() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      s1 = peg$parseclassCharacter();
      if (s1 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 45) {
          s2 = peg$c96;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseclassCharacter();
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c98(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseclassCharacter() {
      var s0, s1;

      s0 = peg$currPos;
      s1 = peg$parsebracketDelimitedCharacter();
      if (s1 !== peg$FAILED) {
        peg$reportedPos = s0;
        s1 = peg$c99(s1);
      }
      s0 = s1;

      return s0;
    }

    function peg$parsebracketDelimitedCharacter() {
      var s0;

      s0 = peg$parsesimpleBracketDelimitedCharacter();
      if (s0 === peg$FAILED) {
        s0 = peg$parsesimpleEscapeSequence();
        if (s0 === peg$FAILED) {
          s0 = peg$parsezeroEscapeSequence();
          if (s0 === peg$FAILED) {
            s0 = peg$parsehexEscapeSequence();
            if (s0 === peg$FAILED) {
              s0 = peg$parseunicodeEscapeSequence();
              if (s0 === peg$FAILED) {
                s0 = peg$parseeolEscapeSequence();
              }
            }
          }
        }
      }

      return s0;
    }

    function peg$parsesimpleBracketDelimitedCharacter() {
      var s0, s1, s2;

      s0 = peg$currPos;
      s1 = peg$currPos;
      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 93) {
        s2 = peg$c93;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c94); }
      }
      if (s2 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 92) {
          s2 = peg$c82;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c83); }
        }
        if (s2 === peg$FAILED) {
          s2 = peg$parseeolChar();
        }
      }
      peg$silentFails--;
      if (s2 === peg$FAILED) {
        s1 = peg$c18;
      } else {
        peg$currPos = s1;
        s1 = peg$c0;
      }
      if (s1 !== peg$FAILED) {
        if (input.length > peg$currPos) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c84); }
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c85(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsesimpleEscapeSequence() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 92) {
        s1 = peg$c82;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c83); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        peg$silentFails++;
        s3 = peg$parsedigit();
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 120) {
            s3 = peg$c100;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c101); }
          }
          if (s3 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 117) {
              s3 = peg$c102;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c103); }
            }
            if (s3 === peg$FAILED) {
              s3 = peg$parseeolChar();
            }
          }
        }
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = peg$c18;
        } else {
          peg$currPos = s2;
          s2 = peg$c0;
        }
        if (s2 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c84); }
          }
          if (s3 !== peg$FAILED) {
            peg$reportedPos = s0;
            s1 = peg$c104(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsezeroEscapeSequence() {
      var s0, s1, s2, s3;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c105) {
        s1 = peg$c105;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c106); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        peg$silentFails++;
        s3 = peg$parsedigit();
        peg$silentFails--;
        if (s3 === peg$FAILED) {
          s2 = peg$c18;
        } else {
          peg$currPos = s2;
          s2 = peg$c0;
        }
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c107();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsehexEscapeSequence() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c108) {
        s1 = peg$c108;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c109); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        s3 = peg$currPos;
        s4 = peg$parsehexDigit();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsehexDigit();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        if (s3 !== peg$FAILED) {
          s3 = input.substring(s2, peg$currPos);
        }
        s2 = s3;
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c110(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseunicodeEscapeSequence() {
      var s0, s1, s2, s3, s4, s5, s6, s7;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c111) {
        s1 = peg$c111;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c112); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        s3 = peg$currPos;
        s4 = peg$parsehexDigit();
        if (s4 !== peg$FAILED) {
          s5 = peg$parsehexDigit();
          if (s5 !== peg$FAILED) {
            s6 = peg$parsehexDigit();
            if (s6 !== peg$FAILED) {
              s7 = peg$parsehexDigit();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$c0;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$c0;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        if (s3 !== peg$FAILED) {
          s3 = input.substring(s2, peg$currPos);
        }
        s2 = s3;
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c110(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseeolEscapeSequence() {
      var s0, s1, s2;

      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 92) {
        s1 = peg$c82;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c83); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseeol();
        if (s2 !== peg$FAILED) {
          peg$reportedPos = s0;
          s1 = peg$c113(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsedigit() {
      var s0;

      if (peg$c114.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c115); }
      }

      return s0;
    }

    function peg$parsehexDigit() {
      var s0;

      if (peg$c116.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c117); }
      }

      return s0;
    }

    function peg$parseletter() {
      var s0;

      s0 = peg$parselowerCaseLetter();
      if (s0 === peg$FAILED) {
        s0 = peg$parseupperCaseLetter();
      }

      return s0;
    }

    function peg$parselowerCaseLetter() {
      var s0;

      if (peg$c118.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c119); }
      }

      return s0;
    }

    function peg$parseupperCaseLetter() {
      var s0;

      if (peg$c120.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c121); }
      }

      return s0;
    }

    function peg$parse__() {
      var s0, s1;

      s0 = [];
      s1 = peg$parsewhitespace();
      if (s1 === peg$FAILED) {
        s1 = peg$parseeol();
        if (s1 === peg$FAILED) {
          s1 = peg$parsecomment();
        }
      }
      while (s1 !== peg$FAILED) {
        s0.push(s1);
        s1 = peg$parsewhitespace();
        if (s1 === peg$FAILED) {
          s1 = peg$parseeol();
          if (s1 === peg$FAILED) {
            s1 = peg$parsecomment();
          }
        }
      }

      return s0;
    }

    function peg$parsecomment() {
      var s0, s1;

      peg$silentFails++;
      s0 = peg$parsesingleLineComment();
      if (s0 === peg$FAILED) {
        s0 = peg$parsemultiLineComment();
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c122); }
      }

      return s0;
    }

    function peg$parsesingleLineComment() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c123) {
        s1 = peg$c123;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c124); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        s5 = peg$parseeolChar();
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = peg$c18;
        } else {
          peg$currPos = s4;
          s4 = peg$c0;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c84); }
          }
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$currPos;
          peg$silentFails++;
          s5 = peg$parseeolChar();
          peg$silentFails--;
          if (s5 === peg$FAILED) {
            s4 = peg$c18;
          } else {
            peg$currPos = s4;
            s4 = peg$c0;
          }
          if (s4 !== peg$FAILED) {
            if (input.length > peg$currPos) {
              s5 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c84); }
            }
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c0;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        }
        if (s2 !== peg$FAILED) {
          s1 = [s1, s2];
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parsemultiLineComment() {
      var s0, s1, s2, s3, s4, s5;

      s0 = peg$currPos;
      if (input.substr(peg$currPos, 2) === peg$c125) {
        s1 = peg$c125;
        peg$currPos += 2;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c126); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$currPos;
        s4 = peg$currPos;
        peg$silentFails++;
        if (input.substr(peg$currPos, 2) === peg$c127) {
          s5 = peg$c127;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c128); }
        }
        peg$silentFails--;
        if (s5 === peg$FAILED) {
          s4 = peg$c18;
        } else {
          peg$currPos = s4;
          s4 = peg$c0;
        }
        if (s4 !== peg$FAILED) {
          if (input.length > peg$currPos) {
            s5 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c84); }
          }
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$c0;
        }
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$currPos;
          s4 = peg$currPos;
          peg$silentFails++;
          if (input.substr(peg$currPos, 2) === peg$c127) {
            s5 = peg$c127;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c128); }
          }
          peg$silentFails--;
          if (s5 === peg$FAILED) {
            s4 = peg$c18;
          } else {
            peg$currPos = s4;
            s4 = peg$c0;
          }
          if (s4 !== peg$FAILED) {
            if (input.length > peg$currPos) {
              s5 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c84); }
            }
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$c0;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$c0;
          }
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c127) {
            s3 = peg$c127;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c128); }
          }
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$c0;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$c0;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$c0;
      }

      return s0;
    }

    function peg$parseeol() {
      var s0, s1;

      peg$silentFails++;
      if (input.charCodeAt(peg$currPos) === 10) {
        s0 = peg$c130;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c131); }
      }
      if (s0 === peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c132) {
          s0 = peg$c132;
          peg$currPos += 2;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c133); }
        }
        if (s0 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 13) {
            s0 = peg$c134;
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c135); }
          }
          if (s0 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 8232) {
              s0 = peg$c136;
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c137); }
            }
            if (s0 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 8233) {
                s0 = peg$c138;
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c139); }
              }
            }
          }
        }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c129); }
      }

      return s0;
    }

    function peg$parseeolChar() {
      var s0;

      if (peg$c140.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c141); }
      }

      return s0;
    }

    function peg$parsewhitespace() {
      var s0, s1;

      peg$silentFails++;
      if (peg$c143.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c144); }
      }
      peg$silentFails--;
      if (s0 === peg$FAILED) {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c142); }
      }

      return s0;
    }


      var utils = require("./utils");


    peg$result = peg$startRuleFunction();

    if (peg$result !== peg$FAILED && peg$currPos === input.length) {
      return peg$result;
    } else {
      if (peg$result !== peg$FAILED && peg$currPos < input.length) {
        peg$fail({ type: "end", description: "end of input" });
      }

      throw peg$buildException(null, peg$maxFailExpected, peg$maxFailPos);
    }
  }

  return {
    SyntaxError: SyntaxError,
    parse:       parse
  };
})();

},{"./utils":19}],18:[function(require,module,exports){
var utils = require("./utils");

module.exports = {
  /* PEG.js version (uses semantic versioning). */
  VERSION: "0.8.0",

  GrammarError: require("./grammar-error"),
  parser:       require("./parser"),
  compiler:     require("./compiler"),

  /*
   * Generates a parser from a specified grammar and returns it.
   *
   * The grammar must be a string in the format described by the metagramar in
   * the parser.pegjs file.
   *
   * Throws |PEG.parser.SyntaxError| if the grammar contains a syntax error or
   * |PEG.GrammarError| if it contains a semantic error. Note that not all
   * errors are detected during the generation and some may protrude to the
   * generated parser and cause its malfunction.
   */
  buildParser: function(grammar) {
    function convertPasses(passes) {
      var converted = {}, stage;

      for (stage in passes) {
        if (passes.hasOwnProperty(stage)) {
          converted[stage] = utils.values(passes[stage]);
        }
      }

      return converted;
    }

    var options = arguments.length > 1 ? utils.clone(arguments[1]) : {},
        plugins = "plugins" in options ? options.plugins : [],
        config  = {
          parser: this.parser,
          passes: convertPasses(this.compiler.passes)
        };

    utils.each(plugins, function(p) { p.use(config, options); });

    return this.compiler.compile(
      config.parser.parse(grammar),
      config.passes,
      options
    );
  }
};

},{"./compiler":9,"./grammar-error":16,"./parser":17,"./utils":19}],19:[function(require,module,exports){
var utils = {
  /* Like Python's |range|, but without |step|. */
  range: function(start, stop) {
    if (stop === undefined) {
      stop = start;
      start = 0;
    }

    var result = new Array(Math.max(0, stop - start));
    for (var i = 0, j = start; j < stop; i++, j++) {
      result[i] = j;
    }
    return result;
  },

  find: function(array, callback) {
    var length = array.length;
    for (var i = 0; i < length; i++) {
      if (callback(array[i])) {
        return array[i];
      }
    }
  },

  indexOf: function(array, callback) {
    var length = array.length;
    for (var i = 0; i < length; i++) {
      if (callback(array[i])) {
        return i;
      }
    }
    return -1;
  },

  contains: function(array, value) {
    /*
     * Stupid IE does not have Array.prototype.indexOf, otherwise this function
     * would be a one-liner.
     */
    var length = array.length;
    for (var i = 0; i < length; i++) {
      if (array[i] === value) {
        return true;
      }
    }
    return false;
  },

  each: function(array, callback) {
    var length = array.length;
    for (var i = 0; i < length; i++) {
      callback(array[i], i);
    }
  },

  map: function(array, callback) {
    var result = [];
    var length = array.length;
    for (var i = 0; i < length; i++) {
      result[i] = callback(array[i], i);
    }
    return result;
  },

  pluck: function(array, key) {
    return utils.map(array, function (e) { return e[key]; });
  },

  keys: function(object) {
    var result = [];
    for (var key in object) {
      if (object.hasOwnProperty(key)) {
        result.push(key);
      }
    }
    return result;
  },

  values: function(object) {
    var result = [];
    for (var key in object) {
      if (object.hasOwnProperty(key)) {
        result.push(object[key]);
      }
    }
    return result;
  },

  clone: function(object) {
    var result = {};
    for (var key in object) {
      if (object.hasOwnProperty(key)) {
        result[key] = object[key];
      }
    }
    return result;
  },

  defaults: function(object, defaults) {
    for (var key in defaults) {
      if (defaults.hasOwnProperty(key)) {
        if (!(key in object)) {
          object[key] = defaults[key];
        }
      }
    }
  },

  /*
   * The code needs to be in sync with the code template in the compilation
   * function for "action" nodes.
   */
  subclass: function(child, parent) {
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();
  },

  /*
   * Returns a string padded on the left to a desired length with a character.
   *
   * The code needs to be in sync with the code template in the compilation
   * function for "action" nodes.
   */
  padLeft: function(input, padding, length) {
    var result = input;

    var padLength = length - input.length;
    for (var i = 0; i < padLength; i++) {
      result = padding + result;
    }

    return result;
  },

  /*
   * Returns an escape sequence for given character. Uses \x for characters <=
   * 0xFF to save space, \u for the rest.
   *
   * The code needs to be in sync with the code template in the compilation
   * function for "action" nodes.
   */
  escape: function(ch) {
    var charCode = ch.charCodeAt(0);
    var escapeChar;
    var length;

    if (charCode <= 0xFF) {
      escapeChar = 'x';
      length = 2;
    } else {
      escapeChar = 'u';
      length = 4;
    }

    return '\\' + escapeChar + utils.padLeft(charCode.toString(16).toUpperCase(), '0', length);
  },

  /*
   * Surrounds the string with quotes and escapes characters inside so that the
   * result is a valid JavaScript string.
   *
   * The code needs to be in sync with the code template in the compilation
   * function for "action" nodes.
   */
  quote: function(s) {
    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a string
     * literal except for the closing quote character, backslash, carriage
     * return, line separator, paragraph separator, and line feed. Any character
     * may appear in the form of an escape sequence.
     *
     * For portability, we also escape all control and non-ASCII characters.
     * Note that "\0" and "\v" escape sequences are not used because JSHint does
     * not like the first and IE the second.
     */
    return '"' + s
      .replace(/\\/g, '\\\\')  // backslash
      .replace(/"/g, '\\"')    // closing quote character
      .replace(/\x08/g, '\\b') // backspace
      .replace(/\t/g, '\\t')   // horizontal tab
      .replace(/\n/g, '\\n')   // line feed
      .replace(/\f/g, '\\f')   // form feed
      .replace(/\r/g, '\\r')   // carriage return
      .replace(/[\x00-\x07\x0B\x0E-\x1F\x80-\uFFFF]/g, utils.escape)
      + '"';
  },

  /*
   * Escapes characters inside the string so that it can be used as a list of
   * characters in a character class of a regular expression.
   */
  quoteForRegexpClass: function(s) {
    /*
     * Based on ECMA-262, 5th ed., 7.8.5 & 15.10.1.
     *
     * For portability, we also escape all control and non-ASCII characters.
     */
    return s
      .replace(/\\/g, '\\\\')  // backslash
      .replace(/\//g, '\\/')   // closing slash
      .replace(/\]/g, '\\]')   // closing bracket
      .replace(/\^/g, '\\^')   // caret
      .replace(/-/g,  '\\-')   // dash
      .replace(/\0/g, '\\0')   // null
      .replace(/\t/g, '\\t')   // horizontal tab
      .replace(/\n/g, '\\n')   // line feed
      .replace(/\v/g, '\\x0B') // vertical tab
      .replace(/\f/g, '\\f')   // form feed
      .replace(/\r/g, '\\r')   // carriage return
      .replace(/[\x01-\x08\x0E-\x1F\x80-\uFFFF]/g, utils.escape);
  },

  /*
   * Builds a node visitor -- a function which takes a node and any number of
   * other parameters, calls an appropriate function according to the node type,
   * passes it all its parameters and returns its value. The functions for
   * various node types are passed in a parameter to |buildNodeVisitor| as a
   * hash.
   */
  buildNodeVisitor: function(functions) {
    return function(node) {
      return functions[node.type].apply(null, arguments);
    };
  },

  findRuleByName: function(ast, name) {
    return utils.find(ast.rules, function(r) { return r.name === name; });
  },

  indexOfRuleByName: function(ast, name) {
    return utils.indexOf(ast.rules, function(r) { return r.name === name; });
  }
};

module.exports = utils;

},{}]},{},[2])(2)
});