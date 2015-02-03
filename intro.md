# Introduction
A stateflow is a collection of steps which has to be executed in a controlled order.
A step is defined as a state, a state has an action which is executed asynchronously.
The next state to go is defined as an "on" mapping either by mapping a state action completion event triggered by an execution callback or
by an event emitted from one of the registered objects.

A step/state is also a resting point, waiting for the next event/decision before going to the next state.

A flow can also be used as an action in an other flow, in this case it's a subflow where the flow end event is mapped to state completion event.

## Intention
The intention of stateflow is provide a means to implement high level processes, using a flow/state machine as a programming language often tends more complex graph than the original implementation.

## Example of shopping cart flow and checkout subflow from [stateflow-example](https://github.com/philipdev/stateflow-example)
### shopping cart
![shopping cart flow](shopping.png)
### checkout subflow
![checkout subflow](checkout.png)

## Use cases
* Guided user interfaces
* Build and deploy systems
* Device handling
* Implementation of workflow processes

