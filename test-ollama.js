const http = require('http');

const data = JSON.stringify({
  model: 'gpt-oss:20b',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
  stream: true,
});

const options = {
  hostname: '127.0.0.1',
  port: 11434,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

const req = http.request(options, (res) => {
  let count = 0;
  res.on('data', (chunk) => {
    count++;
    if (count <= 15) {
      console.log(`Chunk ${count}:`, chunk.toString());
    }
  });
  
  res.on('end', () => {
    console.log('Stream ended');
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
