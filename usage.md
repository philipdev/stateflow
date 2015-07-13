# Example
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
a.action {
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
	this.emit('finish');	
}
// event mapping on end stated is used to map to flow exit event
c.finish -> finish 

```



