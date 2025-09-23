const http = require("http");
const app = require("./app");
const initSocket = require("./api/socket/index.js"); // <-- real‑time layer

const port = process.env.PORT || 3001;

const server = http.createServer(app);

// Attach Socket.io to the same HTTP server
initSocket(server);

server.listen(port, () => {
  console.log(`HTTP & WebSocket server listening on port ${port}`);
});
