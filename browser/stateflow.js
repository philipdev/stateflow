(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.stateflow = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*jslint node: true */
'use strict';
/**
 * @module stateflow
 */
var util = require('util');
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
 * Create a completion function action parameter callback, the callback moves the flow to the next when a on event match.
 * @param state {string} the state where callback is created for
 * @param stateObj {object} 
 * @param flowCompleted {completion} end of flow callback.
 * @return complete {completion}
 * @private
 */
StateFlow.prototype.createStateHandler = function (state, stateObj, flowCompleted) {
    var stateDefinition = this.config[state], self = this, completed = false, stateCompletion;

    if (stateDefinition === undefined) {
        throw new Error("No state defination found for state '" + state + "'");
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
 * For every state there is state object.
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
},{"events":2,"util":6}],2:[function(require,module,exports){
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

},{}],3:[function(require,module,exports){
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

},{}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],6:[function(require,module,exports){
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
},{"./support/isBuffer":5,"_process":4,"inherits":3}]},{},[1])(1)
});