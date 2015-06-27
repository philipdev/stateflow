# Usage
## Javascript
```
var stateflow = require('stateflow');
stateflow.create(fs.readFileSync('myflow.txt','utf8'));

flow.set('myService', service);
flow.registerAction('namedAction', func);
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
