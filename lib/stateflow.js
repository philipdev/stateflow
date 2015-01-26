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
 * @property action {action} executed when the state becomes active, when the action property is a string then it lookup the function the previously registerAction(), when action is an object the flow will create a sub flow which will be started when the state becomes active.
 * @property on {object} key is state completion event value is the next state to goto.
 */

 /**
 * @typedef flowDefinition {object}
 * @property *stateName* {stateDefinition} every state has a state name and a state definition.
 */

/**
 * Instance assigned to each state in a flow and bound to the action's this variable.
 * 
 * @constructor
 * @param {object} config subflow definition which might contain additional properties.
 * @param {string} name state name.
 * @param {StateFlow} parent flow.
 * @property {boolean} active is true when the state is the current state (initial false offcourse).
 * @property {StateFlow|undefined} parent only set on subflows and regular states.
 * @property {stateDefinition} config state defintion
 */
function State(config, name, parent) {
    this.data = {};

    /**
     * @typedef {object} StateFlow~stateDefinition
     * @property {string|State~action|flowDefinition} action - the state action to be executed when the state becomes active
     * @property {object} - an object where the key is the completion event and the value the next target state when this state completes with matching event, * means all events.
     */
    this.config = config;
    this.name = name;
    this.parent = parent;

    // an array of objects with follwing properties: target, event, listener
    this.listeners = [];

    this.on('exit', function () {
        this.listeners.forEach(function (config) {
            config.source.removeListener(config.event, config.listener);
        });

        this.cancelTimeout();
    });
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
 * @param obj {object|function} object or getter function which will be executed on {@link State#get}
 */
State.prototype.set = function (name, obj) {
    this.data[name] = obj;
};

 /**
  * Listen to a service event while the state is active.
  *
  * All events registered with 'listenTo' while be automatically removed when the state exits. 
  * if the listener is a string then it's considered a state completion event.
  *
  * @param objectOrName {object|string} the service name (string) which was registered with set or event emitter instance (object), 
  * @param event {string} the event to listen on
  * @param listener {callback|string} event listener or state completion event
  */
State.prototype.listenTo = function (objectOrName, event, listener) {
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
    }

    listenerConfig.source.on(listenerConfig.event, listenerConfig.listener);
    this.listeners.push(listenerConfig);
};

/**
 * Cancel the previous installed timeout, note this function is impliciltly called when the state exists, but might be necessary when
 * sub sequenctial async calls must be called after operation was complete which should not be influenced by a timeout.
 */
State.prototype.cancelTimeout = function () {
    if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
    }
};

/**
 * Install a state timeout handler.
 * @param timeout {integer} the timeout in ms
 * @param handler {callback|string} the function or completion event (string) to be called when the timeout expires or the completion event to be fired when timeout expires.
 */
State.prototype.installTimeout = function (timeout, handler) {
    var cb, self = this;
    if (typeof handler === 'function') {
        cb = function () {
            handler.call(self);
        };
    } else if (typeof handler === 'string') {
        cb = function () {
            self.stateComplete(handler);
        };
    } else {
        cb = function () {
            self.stateComplete('timeout');
        };
    }
    this.cancelTimeout();
    this.timeoutHandle = setTimeout(cb, timeout);
};

/**
 * StateFlow is an async event state machine, defined with an js object where the property is 
 * the state and the value the state definition.<br/>
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
function StateFlow(config) {
    /**
     * @typedef StateFlow~flowDefinition {object} where the key is the state and the value a {@link stateDefinition}
     */
    State.call(this, config);
    this.actions = {};
    this.states = {};
    this.on('newListener', function (event, listener) {
        // call a state listener when the state is already active
        if (event === 'state:' + this.currentState) {
            listener.call(this, this.currentState);
        }
    });
}
util.inherits(StateFlow, State);

/**
 * Register a named action function
 * @param name the name to be used in the state action property
 * @param action the function to be as 'state action'
 * @memberof StateFlow
 */
StateFlow.prototype.registerAction = function (name, action) {
    this.actions[name] = action;
};

/**
 * Get registered action from the current flow, travel the parent chain until the named action is found (aka action's registered in the parent flow are also available in the subflow).
 * @returns literal registered action {string|object|function}
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
 * @param state {string} the state to get the sub flow
 * @returns {object} the flow definition of a sub flow.
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
 */
StateFlow.prototype.isSubFlowState = function (state) {
    var def = this.config[state];
    if (typeof def.action === 'object') {
        return true;
    }
    if (typeof def.action === 'string' && typeof this.getRegisteredAction(def.action) === 'object') {
        return true;
    }
    return false;
};

/**
 * Get state action function
 * @param state state name to get the action from.
 * @returns {action}
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
    if (typeof def.action) {
        return this.createSubFlowAction();
    }
    throw new Error("No action found for state '" + state + "'");
};

/**
 * @returns {action} subflow state action
 */
StateFlow.prototype.createSubFlowAction = function () {
    return function (complete) {
        this.start(function (event) {
            complete(event);
        });
    };
};


/**
 * Start the flow with the state of type 'begin' 
 * @param complete {completion} callback to be called when the end state has been reached.
 */
StateFlow.prototype.start = function (complete) {
    var states = this.findStatesByType('begin');

    if (states.length === 0) {
        throw new Error('No begin state found!');
    }
    if (states.length > 1) {
        throw new Error('Too many begin states found!');
    }
    // maybe this.emit('flow:start');
    this.stateComplete = complete;
    this.go(states[0], complete);
};

StateFlow.prototype.findStatesByType = function (type) {
    var result = Object.keys(this.config).filter(function (stateName) {
        if (this[stateName].type === type || (type === 'state' && this[stateName].type === undefined)) {
            return true;
        }
    }, this.config);

    return result;
};

/**
 * Set the flow in a specific state
 * @param state {string} the state to set to
 * @param complete {completion} the callback to be called when a state of type 'end' is reached, aka when the "flow-state" has been ended.
 * @property {string} currentState is set to the given state.
 */
StateFlow.prototype.go = function (state, complete) {
    var stateDefinition = this.config[state], stateObj, action;

    if (stateDefinition === undefined) {
        throw new Error("No state defination found for state '" + state + "'");
    }

    stateObj = this.getStateObject(state);
     /**
      * State activation action, can be defined as function, by name (string) or by sub flow definition (object).<br/>
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

/**
 * Create a completion function which is used as the callback argument for the <tt>state</tt> action, this callback will move the flow to the next state when a matching event is found.
 * @param state {string} the state where callback is created for
 * @param stateObj {object} 
 * @param flowCompleted {completion} callback to be called when the flow reaches the end state.
 * @return complete {completion} callback to be use by a state action to continue the flow.
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
 * Get the instance object which will be associated with the state action this.
 * Used to provide functionallity and data state see {State}.
 *
 * For every state there is state object.
 * @param {string} the state name to get an state object for
 * @return {State} the state object
 */
StateFlow.prototype.getStateObject = function (state) {
    if (!this.states[state]) {
        if (this.isSubFlowState(state)) {
            this.states[state] = new StateFlow(this.getSubFlowConfig(state));
        } else {
            this.states[state] = new State(this.config[state]);
        }
        this.states[state].name = state;
        this.states[state].parent = this;
    }
    return this.states[state];
};

module.exports.StateFlow = StateFlow;