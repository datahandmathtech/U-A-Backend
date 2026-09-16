const tls = require('tls');
const targetHost = 'ac-n3u3fkt-shard-00-01.iuq9w0n.mongodb.net';
const start = Date.now();
console.log('Starting TLS connection test...');
const socket = tls.connect({ host: targetHost, port: 27017, servername: targetHost, timeout: 10000 }, () => {
    console.log('SUCCESS: TLS connection established in ' + (Date.now() - start) + 'ms');
    socket.destroy();
});
socket.on('timeout', () => console.log('TIMEOUT'));
socket.on('error', (err) => console.log('ERROR:', err.message));
