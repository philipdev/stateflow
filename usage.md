# Example
## Javascript
```
function loader(resource, cb) {
	fs.readFile(resource,'utf8', function(err, contents) {
		cb(err, contents);
	});
}
var stateflow = require('stateflow');
stateflow.load('myflow.flow', loader, function(error, flow) {
	if(!error) {
		flow.set('myService', service);
		flow.start();
	}
});

```
## Example flow a -> b -> c
```
a.type = begin
a.action(service) {
	service.emit('event');
}
a.'service.event' -> b

b.action {
	this.installTimeout(100, 'mytimeout');
}
b.mytimeout -> c

c.type = end
c -> finish 
```



