var path = require("path");
var nodeRoot = path.dirname(require.main.filename);
var publicPath = path.join(nodeRoot, "public");
var express = require("express");

require("colors");
function parseBool(str) {
  return str.toLowerCase() === "true";
}

let config = {
  ssh: {
    host: null,
    port: 22,
    term: "xterm-color",
    readyTimeout: 20000,
    keepaliveInterval: 120000,
    keepaliveCountMax: 10
  },
  terminal: {
    cursorBlink: true,
    scrollback: 10000,
    tabStopWidth: 8,
    bellStyle: "sound"
  },
  header: {
    text: null,
    background: "green"
  },
  session: {
    name: "Align",
    secret: "A-LIGN4EVER!"
  },
  options: {
    challengeButton: false,
    allowreauth: false
  },
  algorithms: {
    kex: [
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group14-sha1"
    ],
    cipher: [
      "aes128-ctr",
      "aes192-ctr",
      "aes256-ctr",
      "aes128-gcm",
      "aes128-gcm@openssh.com",
      "aes256-gcm",
      "aes256-gcm@openssh.com",
      "aes256-cbc"
    ],
    hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
    compress: ["none", "zlib@openssh.com", "zlib"]
  },
  serverlog: {
    client: false,
    server: false
  },
  verify: false
};

var session = require("express-session")({
  secret: config.session.secret,
  name: config.session.name,
  resave: true,
  saveUninitialized: false,
  unset: "destroy"
});
var app = express();
var compression = require("compression");
var server = require("http").Server(app);
var validator = require("validator");
var io = require("socket.io")(server, { serveClient: false });
var socket = require("./socket");

// express
app.use(compression({ level: 9 }));
app.use(session);
app.disable("x-powered-by");

// static files
app.use(express.static(publicPath));

app.get("/ssh/host/:host?", function(req, res, next) {
  if (req.query.username) req.session.username = req.query.username;
  if (req.query.password) req.session.userpassword = req.query.password;
  res.sendFile(path.join(path.join(publicPath, "client.html")));
  // capture, assign, and validated variables
  req.session.ssh = {
    host:
      (validator.isIP(req.params.host + "") && req.params.host) ||
      (validator.isFQDN(req.params.host) && req.params.host) ||
      (/^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/.test(req.params.host) &&
        req.params.host) ||
      config.ssh.host,
    port:
      (validator.isInt(req.query.port + "", { min: 1, max: 65535 }) &&
        req.query.port) ||
      config.ssh.port,
    header: {
      name: req.query.header || config.header.text,
      background: req.query.headerBackground || config.header.background
    },
    algorithms: config.algorithms,
    keepaliveInterval: config.ssh.keepaliveInterval,
    keepaliveCountMax: config.ssh.keepaliveCountMax,
    term:
      (/^(([a-z]|[A-Z]|[0-9]|[!^(){}\-_~])+)?\w$/.test(req.query.sshterm) &&
        req.query.sshterm) ||
      config.ssh.term,
    terminal: {
      cursorBlink: validator.isBoolean(req.query.cursorBlink + "")
        ? parseBool(req.query.cursorBlink)
        : config.terminal.cursorBlink,
      scrollback:
        validator.isInt(req.query.scrollback + "", { min: 1, max: 200000 }) &&
        req.query.scrollback
          ? req.query.scrollback
          : config.terminal.scrollback,
      tabStopWidth:
        validator.isInt(req.query.tabStopWidth + "", { min: 1, max: 100 }) &&
        req.query.tabStopWidth
          ? req.query.tabStopWidth
          : config.terminal.tabStopWidth,
      bellStyle:
        req.query.bellStyle &&
        ["sound", "none"].indexOf(req.query.bellStyle) > -1
          ? req.query.bellStyle
          : config.terminal.bellStyle
    },
    allowreplay:
      config.options.challengeButton ||
      (validator.isBoolean(req.headers.allowreplay + "")
        ? parseBool(req.headers.allowreplay)
        : false),
    allowreauth: config.options.allowreauth || false,
    mrhsession:
      validator.isAlphanumeric(req.headers.mrhsession + "") &&
      req.headers.mrhsession
        ? req.headers.mrhsession
        : "none",
    serverlog: {
      client: config.serverlog.client || false,
      server: config.serverlog.server || false
    },
    readyTimeout:
      (validator.isInt(req.query.readyTimeout + "", { min: 1, max: 300000 }) &&
        req.query.readyTimeout) ||
      config.ssh.readyTimeout
  };
  if (req.session.ssh.header.name)
    validator.escape(req.session.ssh.header.name);
  if (req.session.ssh.header.background)
    validator.escape(req.session.ssh.header.background);
});

// socket.io
// expose express session with socket.request.session
io.use(function(socket, next) {
  socket.request.res
    ? session(socket.request, socket.request.res, next)
    : next(next);
});

// express error handling
app.use(function(req, res, next) {
  res.status(404).send("Sorry can't find that!");
});

app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// bring up socket
io.on("connection", socket);

server.listen({ host: "0.0.0.0", port: 2222 });
