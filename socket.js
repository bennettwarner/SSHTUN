var SSH = require("ssh2").Client;
var termCols, termRows;
var menuData =
  '<a id="logBtn"><i class="fas fa-clipboard fa-fw"></i> Start Log</a>' +
  '<a id="downloadLogBtn"><i class="fas fa-download fa-fw"></i> Download Log</a>';

module.exports = function socket(socket) {
  // if websocket connection arrives without an express session, kill it
  if (!socket.request.session) {
    socket.emit("401 UNAUTHORIZED");
    socket.disconnect(true);
    return;
  }
  var conn = new SSH();
  socket.on("geometry", function socketOnGeometry(cols, rows) {
    termCols = cols;
    termRows = rows;
  });
  conn.on("banner", function connOnBanner(data) {
    // need to convert to cr/lf for proper formatting
    data = data.replace(/\r?\n/g, "\r\n");
    socket.emit("data", data.toString("utf-8"));
  });

  conn.on("ready", function connOnReady() {
    socket.emit("menu", menuData);
    socket.emit("allowreauth", socket.request.session.ssh.allowreauth);
    socket.emit("setTerminalOpts", socket.request.session.ssh.terminal);
    socket.emit("title", "ssh://" + socket.request.session.ssh.host);
    if (socket.request.session.ssh.header.background)
      socket.emit(
        "headerBackground",
        socket.request.session.ssh.header.background
      );
    if (socket.request.session.ssh.header.name)
      socket.emit("header", socket.request.session.ssh.header.name);
    socket.emit(
      "footer",
      "ssh://" +
        socket.request.session.username +
        "@" +
        socket.request.session.ssh.host +
        ":" +
        socket.request.session.ssh.port
    );
    socket.emit("status", "SSH CONNECTION ESTABLISHED");
    socket.emit("statusBackground", "green");
    socket.emit("allowreplay", socket.request.session.ssh.allowreplay);
    conn.shell(
      {
        term: socket.request.session.ssh.term,
        cols: termCols,
        rows: termRows
      },
      function connShell(err, stream) {
        if (err) {
          SSHerror("EXEC ERROR" + err);
          conn.end();
          return;
        }
        // poc to log commands from client
        if (socket.request.session.ssh.serverlog.client) var dataBuffer;
        socket.on("data", function socketOnData(data) {
          stream.write(data);
          // poc to log commands from client
          if (socket.request.session.ssh.serverlog.client) {
            if (data === "\r") {
              dataBuffer = undefined;
            } else {
              dataBuffer = dataBuffer ? dataBuffer + data : data;
            }
          }
        });
        socket.on("control", function socketOnControl(controlData) {
          switch (controlData) {
            case "replayCredentials":
              if (socket.request.session.ssh.allowreplay) {
                stream.write(socket.request.session.userpassword + "\n");
              }
            /* falls through */
            default:
          }
        });
        socket.on("resize", function socketOnResize(data) {
          stream.setWindow(data.rows, data.cols);
        });
        socket.on("disconnecting", function socketOnDisconnecting(reason) {});
        socket.on("disconnect", function socketOnDisconnect(reason) {
          err = { message: reason };
          SSHerror("CLIENT SOCKET DISCONNECT", err);
          conn.end();
          // socket.request.session.destroy()
        });
        socket.on("error", function socketOnError(err) {
          SSHerror("SOCKET ERROR", err);
          conn.end();
        });

        stream.on("data", function streamOnData(data) {
          socket.emit("data", data.toString("utf-8"));
        });
        stream.on("close", function streamOnClose(code, signal) {
          err = {
            message:
              code || signal
                ? (code ? "CODE: " + code : "") +
                  (code && signal ? " " : "") +
                  (signal ? "SIGNAL: " + signal : "")
                : undefined
          };
          SSHerror("STREAM CLOSE", err);
          conn.end();
        });
        stream.stderr.on("data", function streamStderrOnData(data) {});
      }
    );
  });

  conn.on("end", function connOnEnd(err) {
    SSHerror("CONN END BY HOST", err);
  });
  conn.on("close", function connOnClose(err) {
    SSHerror("CONN CLOSE", err);
  });
  conn.on("error", function connOnError(err) {
    SSHerror("CONN ERROR", err);
  });
  conn.on("keyboard-interactive", function connOnKeyboardInteractive(
    name,
    instructions,
    instructionsLang,
    prompts,
    finish
  ) {
    finish([socket.request.session.userpassword]);
  });
  if (
    socket.request.session.username &&
    socket.request.session.userpassword &&
    socket.request.session.ssh
  ) {
    conn.connect({
      host: socket.request.session.ssh.host,
      port: socket.request.session.ssh.port,
      username: socket.request.session.username,
      password: socket.request.session.userpassword,
      tryKeyboard: true,
      algorithms: socket.request.session.ssh.algorithms,
      readyTimeout: socket.request.session.ssh.readyTimeout,
      keepaliveInterval: socket.request.session.ssh.keepaliveInterval,
      keepaliveCountMax: socket.request.session.ssh.keepaliveCountMax
    });
  } else {
    socket.emit(
      "ssherror",
      "WEBSOCKET ERROR - Refresh the browser and try again"
    );
    socket.request.session.destroy();
    socket.disconnect(true);
  }

  /**
   * Error handling for various events. Outputs error to client, logs to
   * server, destroys session and disconnects socket.
   * @param {string} myFunc Function calling this function
   * @param {object} err    error object or error message
   */
  function SSHerror(myFunc, err) {
    var theError;
    if (socket.request.session) {
      // we just want the first error of the session to pass to the client
      socket.request.session.error =
        socket.request.session.error || (err ? err.message : undefined);
      theError = socket.request.session.error
        ? ": " + socket.request.session.error
        : "";
      // log unsuccessful login attempt
      if (err && err.level === "client-authentication") {
        socket.emit("allowreauth", socket.request.session.ssh.allowreauth);
        socket.emit("reauth");
      } else {
        if (err) {
          theError = err ? ": " + err.message : "";
        }
      }
      socket.emit("ssherror", "SSH " + myFunc + theError);
      socket.request.session.destroy();
      socket.disconnect(true);
    } else {
      theError = err ? ": " + err.message : "";
      socket.disconnect(true);
    }
  }
};
